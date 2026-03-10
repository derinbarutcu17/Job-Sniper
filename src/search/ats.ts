import * as cheerio from "cheerio";
import { decodeEntities, summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
import type { AtsBoardSource, Dependencies, ListingCandidate, SearchLane, SearchResult } from "../types.js";

type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "teamtailor"
  | "smartrecruiters"
  | "recruitee"
  | "personio"
  | "generic";

function inferProvider(url: string): AtsProvider {
  const hostname = domainFromUrl(url);
  if (hostname.includes("greenhouse")) return "greenhouse";
  if (hostname.includes("lever")) return "lever";
  if (hostname.includes("ashby")) return "ashby";
  if (hostname.includes("workable")) return "workable";
  if (hostname.includes("teamtailor")) return "teamtailor";
  if (hostname.includes("smartrecruiters")) return "smartrecruiters";
  if (hostname.includes("recruitee")) return "recruitee";
  if (hostname.includes("personio")) return "personio";
  return "generic";
}

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("uzaktan")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

function parseJsonLdJobs(html: string, pageUrl: string, lane: SearchLane): ListingCandidate[] {
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>>;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (entry["@type"] !== "JobPosting") {
          continue;
        }
        const hiringOrganization = (entry.hiringOrganization ?? {}) as Record<string, unknown>;
        const jobLocation = Array.isArray(entry.jobLocation) ? entry.jobLocation[0] : entry.jobLocation;
        const address = ((jobLocation as Record<string, unknown> | undefined)?.address ?? {}) as Record<
          string,
          unknown
        >;
        const title = decodeEntities(String(entry.title ?? ($("title").text() || "Untitled role")));
        const company = String(
          hiringOrganization.name ?? ($("meta[property='og:site_name']").attr("content") || "Unknown"),
        );
        const url = normalizeUrl(String(entry.url ?? pageUrl));
        const description = summarizeToLine(
          String(entry.description ?? $("meta[name='description']").attr("content") ?? ""),
          600,
        );
        const location = [
          String(address.addressLocality ?? ""),
          String(address.addressCountry ?? ""),
        ]
          .filter(Boolean)
          .join(", ");
        listings.push({
          lane,
          externalId: String(entry.identifier ?? url),
          title,
          company,
          location,
          country: String(address.addressCountry ?? ""),
          language: /[ığüşöçİĞÜŞÖÇ]/.test(description) ? "tr" : "en",
          workModel: inferWorkModel(description),
          employmentType: String(entry.employmentType ?? ""),
          salary: String((entry.baseSalary as Record<string, unknown> | undefined)?.value ?? ""),
          description,
          url,
          source: inferProvider(pageUrl),
          sourceType: "ats",
          sourceUrls: uniqueNonEmpty([pageUrl, url]),
          companyUrl: domainFromUrl(url) ? `https://${domainFromUrl(url)}` : "",
          careersUrl: pageUrl,
          companyLinkedinUrl: "",
          publicContacts: [],
          publicEmails: [],
          raw: entry,
        });
      }
    } catch {
      // Ignore invalid JSON-LD.
    }
  });

  return listings;
}

function collectLinks(html: string): { publicContacts: string[]; publicEmails: string[]; linkedinUrl: string; careersUrl: string } {
  const $ = cheerio.load(html);
  const publicContacts = new Set<string>();
  const publicEmails = new Set<string>();
  let linkedinUrl = "";
  let careersUrl = "";

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    if (href.startsWith("mailto:")) {
      publicEmails.add(href.replace(/^mailto:/, "").trim());
      return;
    }
    if (href.includes("linkedin.com")) {
      linkedinUrl ||= href;
      publicContacts.add(href);
      return;
    }
    const text = $(element).text().trim().toLowerCase();
    if (!careersUrl && (text.includes("career") || text.includes("jobs") || text.includes("kariyer"))) {
      careersUrl = href;
    }
    if (text.includes("team") || text.includes("contact") || text.includes("hiring")) {
      publicContacts.add(href);
    }
  });

  const bodyText = $.text();
  for (const match of bodyText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    publicEmails.add(match[0]);
  }

  return {
    publicContacts: [...publicContacts].slice(0, 10),
    publicEmails: [...publicEmails].slice(0, 10),
    linkedinUrl,
    careersUrl,
  };
}

function parseGenericPage(html: string, result: SearchResult): ListingCandidate[] {
  const $ = cheerio.load(html);
  const contacts = collectLinks(html);
  const title = $("h1").first().text().trim() || result.title;
  const company = $("meta[property='og:site_name']").attr("content") || domainFromUrl(result.url) || "Unknown";
  const description = summarizeToLine(
    $("meta[name='description']").attr("content") || $("main").text() || result.snippet,
    600,
  );

  return [
    {
      lane: result.lane,
      externalId: result.url,
      title,
      company,
      location: /istanbul|i̇stanbul/i.test(html) ? "Istanbul" : /turkiye|türkiye|turkey/i.test(html) ? "Turkey" : "",
      country: /turkiye|türkiye|turkey/i.test(html) ? "Turkey" : "",
      language: /[ığüşöçİĞÜŞÖÇ]/.test(description) ? "tr" : "en",
      workModel: inferWorkModel(description),
      employmentType: /full[- ]time/i.test(description)
        ? "full-time"
        : /part[- ]time/i.test(description)
          ? "part-time"
          : "",
      salary: "",
      description,
      url: result.url,
      source: result.source,
      sourceType: inferProvider(result.url) === "generic" ? "page" : "ats",
      sourceUrls: uniqueNonEmpty([result.url]),
      companyUrl: domainFromUrl(result.url) ? `https://${domainFromUrl(result.url)}` : "",
      careersUrl: contacts.careersUrl || result.url,
      companyLinkedinUrl: contacts.linkedinUrl,
      publicContacts: contacts.publicContacts,
      publicEmails: contacts.publicEmails,
      raw: {},
    },
  ];
}

function greenhouseBoardKey(url: string): string {
  const match = normalizeUrl(url).match(/greenhouse(?:\.io|)\/*(?:job-boards\/)?([^/?#]+)/i);
  return match?.[1] ?? "";
}

async function fetchGreenhouseBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const board = greenhouseBoardKey(source.url);
  if (!board) {
    return [];
  }
  const response = await deps.fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  if (!response.ok) {
    throw new Error(`Greenhouse board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as { jobs?: Array<Record<string, unknown>> };
  return (payload.jobs ?? []).map((job) => ({
    lane: source.lane ?? "ai_coding_jobs",
    externalId: String(job.id ?? ""),
    title: String(job.title ?? "Untitled role"),
    company: source.name,
    location: String((job.location as Record<string, unknown> | undefined)?.name ?? ""),
    country: "",
    language: /[ığüşöçİĞÜŞÖÇ]/.test(String(job.content ?? "")) ? "tr" : "en",
    workModel: inferWorkModel(String(job.content ?? "")),
    employmentType: "",
    salary: "",
    description: summarizeToLine(String(job.content ?? ""), 600),
    url: String(job.absolute_url ?? ""),
    source: source.name,
    sourceType: "ats",
    sourceUrls: uniqueNonEmpty([source.url, String(job.absolute_url ?? "")]),
    companyUrl: "",
    careersUrl: source.url,
    companyLinkedinUrl: "",
    publicContacts: [],
    publicEmails: [],
    raw: job,
  }));
}

function leverBoardKey(url: string): string {
  const match = normalizeUrl(url).match(/jobs\.lever\.co\/([^/?#]+)/i);
  return match?.[1] ?? "";
}

async function fetchLeverBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const board = leverBoardKey(source.url);
  if (!board) {
    return [];
  }
  const response = await deps.fetch(`https://api.lever.co/v0/postings/${board}?mode=json`);
  if (!response.ok) {
    throw new Error(`Lever board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((job) => ({
    lane: source.lane ?? "ai_coding_jobs",
    externalId: String(job.id ?? ""),
    title: String(job.text ?? "Untitled role"),
    company: source.name,
    location: String((job.categories as Record<string, unknown> | undefined)?.location ?? ""),
    country: "",
    language: /[ığüşöçİĞÜŞÖÇ]/.test(String(job.descriptionPlain ?? "")) ? "tr" : "en",
    workModel: inferWorkModel(String(job.descriptionPlain ?? "")),
    employmentType: String((job.categories as Record<string, unknown> | undefined)?.commitment ?? ""),
    salary: "",
    description: summarizeToLine(String(job.descriptionPlain ?? ""), 600),
    url: String(job.hostedUrl ?? ""),
    source: source.name,
    sourceType: "ats",
    sourceUrls: uniqueNonEmpty([source.url, String(job.hostedUrl ?? "")]),
    companyUrl: "",
    careersUrl: source.url,
    companyLinkedinUrl: "",
    publicContacts: [],
    publicEmails: [],
    raw: job,
  }));
}

export async function discoverFromAtsBoard(
  source: AtsBoardSource,
  deps: Dependencies,
): Promise<ListingCandidate[]> {
  if (source.provider === "greenhouse") {
    return fetchGreenhouseBoard(source, deps);
  }
  if (source.provider === "lever") {
    return fetchLeverBoard(source, deps);
  }

  const response = await deps.fetch(source.url);
  if (!response.ok) {
    throw new Error(`ATS board fetch failed with ${response.status} for ${source.url}`);
  }
  const html = await response.text();
  const listings = parseJsonLdJobs(html, source.url, source.lane ?? "company_watch");
  if (listings.length) {
    return listings;
  }
  return parseGenericPage(html, {
    lane: source.lane ?? "company_watch",
    title: source.name,
    url: source.url,
    snippet: "",
    source: source.provider,
  });
}

export async function expandSearchResult(
  result: SearchResult,
  deps: Dependencies,
): Promise<ListingCandidate[]> {
  const response = await deps.fetch(result.url);
  if (!response.ok) {
    throw new Error(`Page fetch failed with ${response.status} for ${result.url}`);
  }
  const html = await response.text();
  const jsonLdListings = parseJsonLdJobs(html, result.url, result.lane);
  if (jsonLdListings.length) {
    return jsonLdListings.map((listing) => ({
      ...listing,
      publicContacts: uniqueNonEmpty([...listing.publicContacts, ...collectLinks(html).publicContacts]),
      publicEmails: uniqueNonEmpty([...listing.publicEmails, ...collectLinks(html).publicEmails]),
    }));
  }
  return parseGenericPage(html, result);
}

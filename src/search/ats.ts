import { mapLimit } from "../lib/async.js";
import { summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
import * as cheerio from "cheerio";
import type {
  AtsBoardSource,
  ContactCandidate,
  Dependencies,
  ListingCandidate,
  PageRecord,
  SearchLane,
  SearchResult,
  SourceType,
} from "../types.js";
import { buildPageRecord, extractContacts, parseCareerHub, parseGenericListing, parseJsonLdListings } from "./extract.js";

export interface CrawlOutcome {
  page: PageRecord;
  contacts: ContactCandidate[];
  listings: ListingCandidate[];
  childUrls: string[];
  usedBrowserFallback: boolean;
}

type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "teamtailor"
  | "smartrecruiters"
  | "recruitee"
  | "personio"
  | "wellfound"
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
  if (hostname.includes("wellfound")) return "wellfound";
  return "generic";
}

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("telecommute") || lower.includes("uzaktan")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

function buildAtsListing(
  source: AtsBoardSource,
  lane: SearchLane,
  job: Record<string, unknown>,
  opts: {
    title: string;
    company?: string;
    location?: string;
    employmentType?: string;
    description?: string;
    url?: string;
    postedAt?: string;
    department?: string;
  },
): ListingCandidate {
  const url = normalizeUrl(opts.url || source.url);
  const description = summarizeToLine(opts.description || "", 1400);
  const location = opts.location || "";
  return {
    lane,
    externalId: String(job.id ?? job.identifier ?? url),
    title: opts.title || "Untitled role",
    titleFamily: "",
    company: opts.company || source.name,
    location,
    country: /turk/i.test(location) ? "Turkey" : "",
    language: /[ığüşöçİĞÜŞÖÇ]/.test(description) ? "tr" : "en",
    workModel: inferWorkModel(description),
    employmentType: opts.employmentType || "",
    salary: "",
    description,
    url,
    applyUrl: url,
    source: source.name,
    sourceType: "ats",
    sourceUrls: uniqueNonEmpty([source.url, url]),
    companyUrl: domainFromUrl(url) ? `https://${domainFromUrl(url)}` : "",
    careersUrl: source.url,
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: opts.postedAt || "",
    validThrough: "",
    department: opts.department || "",
    experienceYearsText: "",
    remoteScope: inferWorkModel(description) === "remote" ? "global" : "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.92,
    sourceConfidence: 0.92,
    isRealJobPage: true,
    raw: job,
  };
}

async function fetchGreenhouseBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const match = normalizeUrl(source.url).match(/greenhouse(?:\.io|)\/*(?:job-boards\/)?([^/?#]+)/i);
  const board = match?.[1];
  if (!board) return [];

  const response = await deps.fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  if (!response.ok) {
    throw new Error(`Greenhouse board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as { jobs?: Array<Record<string, unknown>> };
  return (payload.jobs ?? []).map((job) =>
    buildAtsListing(source, source.lane ?? "ai_coding_jobs", job, {
      title: String(job.title ?? "Untitled role"),
      company: source.name,
      location: String((job.location as Record<string, unknown> | undefined)?.name ?? ""),
      description: String(job.content ?? ""),
      url: String(job.absolute_url ?? source.url),
      postedAt: String(job.updated_at ?? ""),
      department: String((job.metadata as Array<Record<string, unknown>> | undefined)?.[0]?.value ?? ""),
    }),
  );
}

async function fetchLeverBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const match = normalizeUrl(source.url).match(/jobs\.lever\.co\/([^/?#]+)/i);
  const board = match?.[1];
  if (!board) return [];

  const response = await deps.fetch(`https://api.lever.co/v0/postings/${board}?mode=json`);
  if (!response.ok) {
    throw new Error(`Lever board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((job) =>
    buildAtsListing(source, source.lane ?? "ai_coding_jobs", job, {
      title: String(job.text ?? "Untitled role"),
      company: source.name,
      location: String((job.categories as Record<string, unknown> | undefined)?.location ?? ""),
      employmentType: String((job.categories as Record<string, unknown> | undefined)?.commitment ?? ""),
      description: String(job.descriptionPlain ?? ""),
      url: String(job.hostedUrl ?? source.url),
      postedAt: String(job.createdAt ?? ""),
      department: String((job.categories as Record<string, unknown> | undefined)?.team ?? ""),
    }),
  );
}

function mergeStructuredContacts(listings: ListingCandidate[]): ListingCandidate[] {
  return listings.map((listing) => {
    if (!listing.applicationContactEmail) {
      return listing;
    }
    const contact: ContactCandidate = {
      kind: "application_email",
      name: listing.applicationContactName,
      title: "Application Contact",
      email: listing.applicationContactEmail,
      linkedinUrl: "",
      sourceUrl: listing.url,
      confidence: "high",
      evidenceType: "structured_data",
      evidenceExcerpt: listing.applicationContactEmail,
      isPublic: true,
      pageType: "job_detail",
    };
    return {
      ...listing,
      publicContacts: [...listing.publicContacts, contact],
    };
  });
}

export async function crawlUrl(
  url: string,
  lane: SearchLane,
  sourceType: SourceType,
  provider: string,
  deps: Dependencies,
): Promise<CrawlOutcome> {
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status} for ${url}`);
  }

  const html = await response.text();
  const page = buildPageRecord(url, html, provider, sourceType);
  const contacts = extractContacts(page);
  const structured = mergeStructuredContacts(parseJsonLdListings(page, lane, contacts));
  const listings =
    structured.length > 0
      ? structured
      : page.pageType === "job_detail"
        ? parseGenericListing(page, lane, contacts)
        : [];
  const childUrls = page.pageType === "career_hub" ? parseCareerHub(page, lane) : [];

  return {
    page,
    contacts,
    listings,
    childUrls,
    usedBrowserFallback: false,
  };
}

function absoluteWellfoundUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `https://wellfound.com${href.startsWith("/") ? href : `/${href}`}`;
}

async function fetchWellfoundBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const response = await deps.fetch(source.url);
  if (!response.ok) {
    throw new Error(`Wellfound fetch failed for ${source.url} with ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];

  if ((source.lane ?? "company_watch") === "company_watch") {
    const seen = new Set<string>();
    $("a[href*='/company/']").each((_, element) => {
      const anchor = $(element);
      const title = anchor.text().trim();
      const href = absoluteWellfoundUrl(anchor.attr("href") ?? "");
      if (!title || !href || seen.has(href) || /view\s+all\s+\d+\s+jobs/i.test(title) || /company logo/i.test(title)) return;
      seen.add(href);
      const cardText = anchor.closest("div").parent().text().replace(/\s+/g, " ").trim();
      listings.push({
        lane: "company_watch",
        externalId: href,
        title,
        titleFamily: "",
        company: title,
        location: /istanbul/i.test(cardText) ? "Istanbul" : "",
        country: /turkey|türkiye/i.test(cardText) || /istanbul/i.test(cardText) ? "Turkey" : "",
        language: /[ığüşöçİĞÜŞÖÇ]/.test(cardText) ? "tr" : "en",
        workModel: inferWorkModel(cardText),
        employmentType: "",
        salary: "",
        description: summarizeToLine(cardText, 1200),
        url: href,
        applyUrl: href,
        source: "Wellfound",
        sourceType: "ats",
        sourceUrls: uniqueNonEmpty([source.url, href]),
        companyUrl: href,
        careersUrl: href.endsWith("/jobs") ? href : `${href}/jobs`,
        aboutUrl: href,
        teamUrl: "",
        contactUrl: href,
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: "",
        validThrough: "",
        department: "",
        experienceYearsText: "",
        remoteScope: "",
        applicantLocationRequirements: [],
        applicationContactName: "",
        applicationContactEmail: "",
        parseConfidence: 0.78,
        sourceConfidence: 0.82,
        isRealJobPage: false,
        raw: { provider: "wellfound", type: "company_watch" },
      });
    });
    return listings;
  }

  const seen = new Set<string>();
  $("a[href*='/jobs/']").each((_, element) => {
    const anchor = $(element);
    const title = anchor.text().trim();
    const href = absoluteWellfoundUrl(anchor.attr("href") ?? "");
    if (!title || !href || seen.has(href) || /^find jobs$/i.test(title)) return;
    seen.add(href);
    const cardText = anchor.closest("div").parent().text().replace(/\s+/g, " ").trim();
    listings.push({
      lane: source.lane ?? "design_jobs",
      externalId: href,
      title,
      titleFamily: "",
      company: "",
      location: /istanbul/i.test(cardText) ? "Istanbul" : /remote/i.test(cardText) ? "Remote" : "",
      country: /turkey|türkiye/i.test(cardText) || /istanbul/i.test(cardText) ? "Turkey" : "",
      language: /[ığüşöçİĞÜŞÖÇ]/.test(cardText) ? "tr" : "en",
      workModel: inferWorkModel(cardText),
      employmentType: /full-time/i.test(cardText) ? "full-time" : "",
      salary: (cardText.match(/([$€£][^•]+(?:•\s*[^•]+)?)/)?.[1] ?? "").trim(),
      description: summarizeToLine(cardText, 1200),
      url: href,
      applyUrl: href,
      source: "Wellfound",
      sourceType: "ats",
      sourceUrls: uniqueNonEmpty([source.url, href]),
      companyUrl: "",
      careersUrl: source.url,
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: (cardText.match(/(\d+\s+(?:day|days|week|weeks|month|months)\s+ago)/i)?.[1] ?? "").trim(),
      validThrough: "",
      department: "",
      experienceYearsText: (cardText.match(/(\d+\s+years?\s+of\s+exp)/i)?.[1] ?? "").trim(),
      remoteScope: /remote/i.test(cardText) ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.72,
      sourceConfidence: 0.8,
      isRealJobPage: true,
      raw: { provider: "wellfound", type: "job" },
    });
  });
  return listings;
}

async function discoverGenericBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const outcome = await crawlUrl(source.url, source.lane ?? "company_watch", "ats", source.provider || inferProvider(source.url), deps);
  const direct = [...outcome.listings];
  if (!outcome.childUrls.length) {
    return direct;
  }

  const expanded = await mapLimit(outcome.childUrls.slice(0, 20), 4, async (childUrl) => {
    try {
      return (await crawlUrl(childUrl, source.lane ?? "ai_coding_jobs", "ats", source.provider || inferProvider(childUrl), deps)).listings;
    } catch {
      return [];
    }
  });

  return [...direct, ...expanded.flat()];
}

export async function discoverFromAtsBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  switch (source.provider || inferProvider(source.url)) {
    case "greenhouse":
      return fetchGreenhouseBoard(source, deps);
    case "lever":
      return fetchLeverBoard(source, deps);
    case "wellfound":
      return fetchWellfoundBoard(source, deps);
    default:
      return discoverGenericBoard(source, deps);
  }
}

export async function expandSearchResult(result: SearchResult, deps: Dependencies): Promise<ListingCandidate[]> {
  const outcome = await crawlUrl(result.url, result.lane, "search", result.provider, deps);
  if (outcome.listings.length) {
    return outcome.listings;
  }
  if (!outcome.childUrls.length) {
    return [];
  }
  const nested = await mapLimit(outcome.childUrls.slice(0, 12), 4, async (childUrl) => {
    try {
      return (await crawlUrl(childUrl, result.lane, "career_page", result.provider, deps)).listings;
    } catch {
      return [];
    }
  });
  return nested.flat();
}

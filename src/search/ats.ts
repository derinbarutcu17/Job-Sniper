import { mapLimit } from "../lib/async.js";
import { summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
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

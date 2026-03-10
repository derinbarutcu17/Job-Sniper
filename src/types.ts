export type SearchLane = "design_jobs" | "ai_coding_jobs" | "company_watch";
export type SourceType = "search" | "rss" | "ats" | "page";
export type WorkModel = "remote" | "hybrid" | "onsite" | "unknown";
export type Category = "Good Match" | "Mid Match" | "Low Match" | "Excluded";

export interface LaneConfig {
  enabled: boolean;
  queries: {
    tr: string[];
    en: string[];
  };
  keywords: string[];
}

export interface RssSource {
  name: string;
  url: string;
}

export interface AtsBoardSource {
  name: string;
  provider: string;
  url: string;
  lane?: SearchLane;
}

export interface SniperConfig {
  search: {
    maxResultsPerQuery: number;
    maxQueriesPerLane: number;
    minScoreThreshold: number;
    browserFallback: boolean;
    priorityCities: string[];
    priorityCountries: string[];
  };
  lanes: Record<SearchLane, LaneConfig>;
  sources: {
    rss: RssSource[];
    atsBoards: AtsBoardSource[];
  };
  blacklist: {
    companies: string[];
    keywords: string[];
    lanes: Record<SearchLane, string[]>;
  };
  sheets: {
    spreadsheetId: string;
    createIfMissing: boolean;
    folderId: string;
    tabs: {
      jobs: string;
      companies: string;
      contacts: string;
    };
  };
}

export interface ProfileSummary {
  roleFamilies: string[];
  seniorityCeiling: string;
  preferredLocations: string[];
  languagePreference: string[];
  toolSignals: string[];
  summary: string;
}

export interface SearchQuery {
  lane: SearchLane;
  locale: "tr" | "en";
  query: string;
}

export interface SearchResult {
  lane: SearchLane;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface ListingCandidate {
  lane: SearchLane;
  externalId?: string;
  title: string;
  company: string;
  location: string;
  country: string;
  language: string;
  workModel: WorkModel;
  employmentType: string;
  salary: string;
  description: string;
  url: string;
  source: string;
  sourceType: SourceType;
  sourceUrls: string[];
  companyUrl: string;
  careersUrl: string;
  companyLinkedinUrl: string;
  publicContacts: string[];
  publicEmails: string[];
  raw?: Record<string, unknown>;
}

export interface CompanyRecordInput {
  canonicalKey: string;
  name: string;
  domain: string;
  location: string;
  companyUrl: string;
  careersUrl: string;
  linkedinUrl: string;
  description: string;
  sourceUrls: string[];
  publicContacts: string[];
  lastSeenAt: string;
}

export interface ContactRecordInput {
  canonicalKey: string;
  companyCanonicalKey: string;
  name: string;
  title: string;
  email: string;
  sourceUrl: string;
  linkedinUrl: string;
  kind: string;
  notes: string;
  lastSeenAt: string;
}

export interface JobRecord {
  id: number;
  canonical_key: string;
  external_id: string;
  title: string;
  company_id: number | null;
  company_name: string;
  location: string;
  country: string;
  language: string;
  work_model: WorkModel;
  employment_type: string;
  salary: string;
  description: string;
  url: string;
  source: string;
  source_type: SourceType;
  lane: SearchLane;
  status: string;
  category: Category;
  score: number;
  match_rationale: string;
  relevant_projects: string;
  outreach_draft: string;
  public_contacts: string;
  source_urls: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  manual_status: string;
  owner_notes: string;
  priority: string;
  outreach_state: string;
  manual_contact_override: string;
}

export interface RunSummary {
  totalFound: number;
  totalNew: number;
  totalUpdated: number;
  excluded: number;
  companiesTouched: number;
  contactsTouched: number;
}

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface Dependencies {
  fetch: (input: string, init?: RequestInit) => Promise<HttpResponseLike>;
  now: () => Date;
}

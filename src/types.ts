export type SearchLane = "design_jobs" | "ai_coding_jobs" | "company_watch";
export type SourceType = "search" | "rss" | "ats" | "page" | "sitemap" | "career_page" | "team_page";
export type WorkModel = "remote" | "hybrid" | "onsite" | "unknown";
export type Category = "Good Match" | "Mid Match" | "Low Match" | "Excluded";
export type ContactKind =
  | "application_email"
  | "careers_email"
  | "general_contact_email"
  | "press_email"
  | "founder_email"
  | "recruiter_email"
  | "contact_form"
  | "linkedin_company"
  | "linkedin_person"
  | "team_page";
export type ConfidenceBand = "very_low" | "low" | "medium" | "high";
export type SeniorityTarget = "intern" | "junior" | "mid" | "senior";
export type PageIntent = "job" | "company" | "contact" | "unknown";
export type PageType = "job_detail" | "career_hub" | "team_page" | "contact_page" | "about_page" | "generic";

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
    searchProviderConcurrency: number;
    pageFetchConcurrency: number;
    maxPagesPerDomainPerRun: number;
    retries: number;
    timeoutMs: number;
    priorityCities: string[];
    priorityCountries: string[];
    remoteScopes: string[];
  };
  lanes: Record<SearchLane, LaneConfig>;
  sources: {
    rss: RssSource[];
    atsBoards: AtsBoardSource[];
  };
  blacklist: {
    companies: string[];
    keywords: string[];
    titleTerms: string[];
    softPenaltyTerms: string[];
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
      runMetrics: string;
    };
  };
}

export interface ProfileSummary {
  roleFamilies: string[];
  targetSeniority: SeniorityTarget;
  allowStretchRoles: boolean;
  avoidTitleTerms: string[];
  preferredLocations: string[];
  languagePreference: string[];
  toolSignals: string[];
  summary: string;
}

export interface SearchQuery {
  lane: SearchLane;
  locale: "tr" | "en";
  query: string;
  family: "job" | "company" | "contact";
  providerHints?: string[];
}

export interface SearchResult {
  lane: SearchLane;
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  provider: string;
}

export interface DiscoveryCandidate {
  url: string;
  normalizedUrl: string;
  sourceType: SourceType;
  lane: SearchLane;
  intent: PageIntent;
  query?: string;
  confidence: number;
  source: string;
  discoveredAt: string;
  domain: string;
  title: string;
  snippet: string;
}

export interface PageRecord {
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceType: SourceType;
  pageType: PageType;
  intent: PageIntent;
  title: string;
  text: string;
  html: string;
  provider: string;
}

export interface ListingCandidate {
  lane: SearchLane;
  externalId?: string;
  title: string;
  titleFamily: string;
  company: string;
  location: string;
  country: string;
  language: string;
  workModel: WorkModel;
  employmentType: string;
  salary: string;
  description: string;
  url: string;
  applyUrl: string;
  source: string;
  sourceType: SourceType;
  sourceUrls: string[];
  companyUrl: string;
  careersUrl: string;
  aboutUrl: string;
  teamUrl: string;
  contactUrl: string;
  pressUrl: string;
  companyLinkedinUrl: string;
  publicContacts: ContactCandidate[];
  postedAt: string;
  validThrough: string;
  department: string;
  experienceYearsText: string;
  remoteScope: string;
  applicantLocationRequirements: string[];
  applicationContactName: string;
  applicationContactEmail: string;
  parseConfidence: number;
  sourceConfidence: number;
  isRealJobPage: boolean;
  raw?: Record<string, unknown>;
}

export interface ContactCandidate {
  kind: ContactKind;
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  sourceUrl: string;
  confidence: ConfidenceBand;
  evidenceType: string;
  evidenceExcerpt: string;
  isPublic: boolean;
  pageType: PageType;
}

export interface CompanyRecordInput {
  canonicalKey: string;
  name: string;
  domain: string;
  location: string;
  companyUrl: string;
  careersUrl: string;
  aboutUrl: string;
  teamUrl: string;
  contactUrl: string;
  pressUrl: string;
  linkedinUrl: string;
  description: string;
  sourceUrls: string[];
  publicContacts: string[];
  startupSignals: string[];
  hiringSignals: string[];
  founderNames: string[];
  cities: string[];
  sizeBand: string;
  stageText: string;
  remotePolicy: string;
  openRoleCount: number;
  startupScore: number;
  companyFitScore: number;
  hiringSignalScore: number;
  contactabilityScore: number;
  isStartupCandidate: boolean;
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
  contactKind: ContactKind;
  notes: string;
  confidence: ConfidenceBand;
  evidenceType: string;
  evidenceExcerpt: string;
  isPublic: boolean;
  lastVerifiedAt: string;
  pageType: PageType;
  lastSeenAt: string;
}

export interface ScoreBreakdown {
  titleFit: number;
  skillFit: number;
  seniorityFit: number;
  locationFit: number;
  workModelFit: number;
  languageFit: number;
  companyFit: number;
  startupFit: number;
  freshnessFit: number;
  contactabilityFit: number;
  sourceQualityFit: number;
  positives: string[];
  negatives: string[];
  gatesPassed: string[];
  gatesFailed: string[];
}

export interface JobRecord {
  id: number;
  canonical_key: string;
  duplicate_group_key: string;
  external_id: string;
  title: string;
  title_family: string;
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
  apply_url: string;
  source: string;
  source_type: SourceType;
  lane: SearchLane;
  status: string;
  category: Category;
  score: number;
  eligibility: string;
  match_rationale: string;
  score_explanation_json: string;
  relevant_projects: string;
  outreach_draft: string;
  public_contacts: string;
  source_urls: string;
  posted_at: string;
  valid_through: string;
  department: string;
  experience_years_text: string;
  remote_scope: string;
  parse_confidence: number;
  source_confidence: number;
  freshness_score: number;
  contactability_score: number;
  company_fit_score: number;
  startup_fit_score: number;
  is_real_job_page: number;
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
  deduped: number;
  parsed: number;
  fetchSuccessRate: number;
  parseSuccessRate: number;
  jsFallbackRate: number;
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

export interface SearchProvider {
  name: string;
  search(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]>;
}

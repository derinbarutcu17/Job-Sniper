import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./lib/paths.js";
import type { SearchLane, SniperConfig } from "./types.js";

export const defaultConfig: SniperConfig = {
  search: {
    maxResultsPerQuery: 8,
    maxQueriesPerLane: 8,
    minScoreThreshold: 45,
    browserFallback: false,
    searchProviderConcurrency: 4,
    pageFetchConcurrency: 6,
    maxPagesPerDomainPerRun: 10,
    retries: 2,
    timeoutMs: 10000,
    priorityCities: ["Berlin"],
    priorityCountries: ["Germany", "Deutschland"],
    remoteScopes: ["remote", "hybrid"],
  },
  lanes: {
    design_jobs: {
      enabled: true,
      queries: {
        tr: [],
        en: [
          "Berlin product designer jobs",
          "Germany UX UI designer careers",
          "Berlin design engineer figma react jobs",
        ],
      },
      keywords: [
        "product designer",
        "ux",
        "ui",
        "figma",
        "design systems",
        "creative technologist",
        "design engineer",
      ],
    },
    ai_coding_jobs: {
      enabled: true,
      queries: {
        tr: [],
        en: [
          "Berlin AI engineer jobs",
          "Germany LLM engineer jobs",
          "Berlin agent engineer TypeScript Python startup",
        ],
      },
      keywords: [
        "ai engineer",
        "llm",
        "agent",
        "automation",
        "typescript",
        "node",
        "python",
        "developer tools",
        "creative automation",
      ],
    },
    company_watch: {
      enabled: true,
      queries: {
        tr: [],
        en: [
          "Berlin AI startup careers",
          "Germany product design startup team",
          "creative AI startup Berlin careers",
        ],
      },
      keywords: ["careers", "jobs", "hiring", "team", "startup", "founding", "series a", "seed"],
    },
  },
  sources: {
    rss: [
      { name: "Berlin Startup Jobs Design", url: "https://berlinstartupjobs.com/design/feed/" },
      { name: "Berlin Startup Jobs Engineering", url: "https://berlinstartupjobs.com/engineering/feed/" },
    ],
    atsBoards: [
      { name: "Wellfound Berlin Startups", provider: "wellfound", url: "https://wellfound.com/startups/location/berlin-berlin", lane: "company_watch" },
      { name: "Wellfound Berlin Design Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "design_jobs" },
      { name: "Wellfound Berlin AI / Engineering Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "ai_coding_jobs" }
    ],
  },
  blacklist: {
    companies: [],
    keywords: ["account executive", "sales", "gtm", "performance marketing", "chief of staff", "cto", "cfo"],
    titleTerms: ["senior", "lead", "manager", "director", "head", "vp", "principal", "staff", "founder"],
    softPenaltyTerms: ["stakeholder management", "people management", "budget ownership", "consulting"],
    lanes: {
      design_jobs: [],
      ai_coding_jobs: [],
      company_watch: [],
    },
  },
  sheets: {
    spreadsheetId: "",
    createIfMissing: true,
    folderId: "",
    tabs: {
      jobs: "Jobs",
      companies: "Companies",
      contacts: "Contacts",
      runMetrics: "RunMetrics",
    },
  },
};

function mergeLane(base: SniperConfig["lanes"][SearchLane], override?: Partial<SniperConfig["lanes"][SearchLane]>) {
  return {
    ...base,
    ...(override ?? {}),
    queries: {
      tr: override?.queries?.tr ?? base.queries.tr,
      en: override?.queries?.en ?? base.queries.en,
    },
    keywords: override?.keywords ?? base.keywords,
  };
}

function mergeConfig(base: SniperConfig, overrides: Partial<SniperConfig>): SniperConfig {
  return {
    ...base,
    ...overrides,
    search: { ...base.search, ...(overrides.search ?? {}) },
    lanes: {
      design_jobs: mergeLane(base.lanes.design_jobs, overrides.lanes?.design_jobs),
      ai_coding_jobs: mergeLane(base.lanes.ai_coding_jobs, overrides.lanes?.ai_coding_jobs),
      company_watch: mergeLane(base.lanes.company_watch, overrides.lanes?.company_watch),
    },
    sources: {
      rss: overrides.sources?.rss ?? base.sources.rss,
      atsBoards: overrides.sources?.atsBoards ?? base.sources.atsBoards,
    },
    blacklist: {
      companies: overrides.blacklist?.companies ?? base.blacklist.companies,
      keywords: overrides.blacklist?.keywords ?? base.blacklist.keywords,
      titleTerms: overrides.blacklist?.titleTerms ?? base.blacklist.titleTerms,
      softPenaltyTerms: overrides.blacklist?.softPenaltyTerms ?? base.blacklist.softPenaltyTerms,
      lanes: {
        design_jobs: overrides.blacklist?.lanes?.design_jobs ?? base.blacklist.lanes.design_jobs,
        ai_coding_jobs: overrides.blacklist?.lanes?.ai_coding_jobs ?? base.blacklist.lanes.ai_coding_jobs,
        company_watch: overrides.blacklist?.lanes?.company_watch ?? base.blacklist.lanes.company_watch,
      },
    },
    sheets: {
      ...base.sheets,
      ...(overrides.sheets ?? {}),
      tabs: { ...base.sheets.tabs, ...(overrides.sheets?.tabs ?? {}) },
    },
  };
}

function migrateLegacyConfig(raw: Record<string, unknown>): Partial<SniperConfig> {
  const search = (raw.search ?? {}) as Record<string, unknown>;
  const legacySources = Array.isArray(raw.sources) ? (raw.sources as Array<Record<string, unknown>>) : [];
  const blacklist = (raw.blacklist ?? {}) as Record<string, unknown>;
  const includeKeywords = Array.isArray(search.include_keywords)
    ? search.include_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];
  const excludeKeywords = Array.isArray(search.exclude_keywords)
    ? search.exclude_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    search: {
      minScoreThreshold:
        typeof search.min_match_threshold === "number"
          ? search.min_match_threshold
          : defaultConfig.search.minScoreThreshold,
    } as Partial<SniperConfig["search"]> as SniperConfig["search"],
    lanes: {
      design_jobs: { keywords: includeKeywords } as SniperConfig["lanes"]["design_jobs"],
      ai_coding_jobs: { keywords: includeKeywords } as SniperConfig["lanes"]["ai_coding_jobs"],
      company_watch: { keywords: includeKeywords } as SniperConfig["lanes"]["company_watch"],
    } as SniperConfig["lanes"],
    sources: {
      rss: legacySources
        .filter((entry) => entry.type === "rss" && typeof entry.url === "string")
        .map((entry) => ({ name: String(entry.name ?? entry.url), url: String(entry.url) })),
      atsBoards: defaultConfig.sources.atsBoards,
    },
    blacklist: {
      companies: Array.isArray(blacklist.companies)
        ? blacklist.companies.filter((entry): entry is string => typeof entry === "string")
        : [],
      keywords: excludeKeywords.length ? excludeKeywords : defaultConfig.blacklist.keywords,
      titleTerms: defaultConfig.blacklist.titleTerms,
      softPenaltyTerms: defaultConfig.blacklist.softPenaltyTerms,
      lanes: defaultConfig.blacklist.lanes,
    },
  };
}

export function loadConfig(baseDir: string): SniperConfig {
  const configPath = path.join(baseDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const looksModern =
    typeof parsed.lanes === "object" &&
    parsed.lanes !== null &&
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources);

  return looksModern
    ? mergeConfig(defaultConfig, parsed as Partial<SniperConfig>)
    : mergeConfig(defaultConfig, migrateLegacyConfig(parsed));
}

export function saveConfig(baseDir: string, config: SniperConfig): void {
  ensureDir(baseDir);
  fs.writeFileSync(path.join(baseDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

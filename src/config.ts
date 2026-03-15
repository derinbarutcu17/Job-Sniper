import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./lib/paths.js";
import { builtInRolePacks } from "./role-packs.js";
import type { LaneConfig, LaneId, SniperConfig } from "./types.js";

type ConfigOverrides = Omit<Partial<SniperConfig>, "lanes"> & {
  lanes?: Record<LaneId, Partial<LaneConfig>>;
};

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
  lanes: builtInRolePacks,
  sources: {
    rss: [
      { name: "Berlin Startup Jobs Design", url: "https://berlinstartupjobs.com/design/feed/" },
      { name: "Berlin Startup Jobs Engineering", url: "https://berlinstartupjobs.com/engineering/feed/" },
    ],
    atsBoards: [
      { name: "Wellfound Berlin Startups", provider: "wellfound", url: "https://wellfound.com/startups/location/berlin-berlin", lane: "company_watch" },
      { name: "Wellfound Berlin Design Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "design_jobs" },
      { name: "Wellfound Berlin AI / Engineering Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "ai_coding_jobs" },
    ],
  },
  blacklist: {
    companies: [],
    keywords: ["account executive", "sales", "gtm", "performance marketing", "chief of staff", "cto", "cfo"],
    titleTerms: ["senior", "lead", "manager", "director", "head", "vp", "principal", "staff", "founder"],
    softPenaltyTerms: ["stakeholder management", "people management", "budget ownership", "consulting"],
    lanes: Object.fromEntries(Object.keys(builtInRolePacks).map((lane) => [lane, []])),
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

function mergeLane(base: LaneConfig | undefined, override?: Partial<LaneConfig>): LaneConfig {
  return {
    label: override?.label ?? base?.label ?? "Custom Lane",
    type: override?.type ?? base?.type ?? "job",
    enabled: override?.enabled ?? base?.enabled ?? true,
    queries: {
      tr: override?.queries?.tr ?? base?.queries.tr ?? [],
      en: override?.queries?.en ?? base?.queries.en ?? [],
    },
    keywords: override?.keywords ?? base?.keywords ?? [],
    queryTerms: override?.queryTerms ?? base?.queryTerms ?? base?.keywords ?? [],
    profileSignals: override?.profileSignals ?? base?.profileSignals ?? base?.keywords ?? [],
    titleFamilies: override?.titleFamilies ?? base?.titleFamilies ?? [],
    mismatchTerms: override?.mismatchTerms ?? base?.mismatchTerms ?? [],
    startupTerms: override?.startupTerms ?? base?.startupTerms ?? [],
    companyTerms: override?.companyTerms ?? base?.companyTerms ?? [],
  };
}

function mergeLanes(
  base: Record<LaneId, LaneConfig>,
  overrides?: Record<LaneId, Partial<LaneConfig>>,
): Record<LaneId, LaneConfig> {
  const allLaneIds = new Set<LaneId>([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  const lanes: Record<LaneId, LaneConfig> = {};
  for (const lane of allLaneIds) {
    lanes[lane] = mergeLane(base[lane], overrides?.[lane]);
  }
  return lanes;
}

function mergeLaneBlacklists(base: Record<LaneId, string[]>, overrides?: Record<LaneId, string[]>): Record<LaneId, string[]> {
  const allLaneIds = new Set<LaneId>([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  const lanes: Record<LaneId, string[]> = {};
  for (const lane of allLaneIds) {
    lanes[lane] = overrides?.[lane] ?? base[lane] ?? [];
  }
  return lanes;
}

function mergeConfig(base: SniperConfig, overrides: ConfigOverrides): SniperConfig {
  return {
    ...base,
    ...overrides,
    search: { ...base.search, ...(overrides.search ?? {}) },
    lanes: mergeLanes(base.lanes, overrides.lanes),
    sources: {
      rss: overrides.sources?.rss ?? base.sources.rss,
      atsBoards: overrides.sources?.atsBoards ?? base.sources.atsBoards,
    },
    blacklist: {
      companies: overrides.blacklist?.companies ?? base.blacklist.companies,
      keywords: overrides.blacklist?.keywords ?? base.blacklist.keywords,
      titleTerms: overrides.blacklist?.titleTerms ?? base.blacklist.titleTerms,
      softPenaltyTerms: overrides.blacklist?.softPenaltyTerms ?? base.blacklist.softPenaltyTerms,
      lanes: mergeLaneBlacklists(base.blacklist.lanes, overrides.blacklist?.lanes),
    },
    sheets: {
      ...base.sheets,
      ...(overrides.sheets ?? {}),
      tabs: { ...base.sheets.tabs, ...(overrides.sheets?.tabs ?? {}) },
    },
  };
}

function migrateLegacyConfig(raw: Record<string, unknown>): ConfigOverrides {
  const search = (raw.search ?? {}) as Record<string, unknown>;
  const legacySources = Array.isArray(raw.sources) ? (raw.sources as Array<Record<string, unknown>>) : [];
  const blacklist = (raw.blacklist ?? {}) as Record<string, unknown>;
  const includeKeywords = Array.isArray(search.include_keywords)
    ? search.include_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];
  const excludeKeywords = Array.isArray(search.exclude_keywords)
    ? search.exclude_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];

  const lanes = Object.fromEntries(
    Object.keys(defaultConfig.lanes).map((lane) => [
      lane,
      { keywords: includeKeywords } as Partial<LaneConfig>,
    ]),
  ) as Record<LaneId, Partial<LaneConfig>>;

  return {
    search: {
      minScoreThreshold:
        typeof search.min_match_threshold === "number"
          ? search.min_match_threshold
          : defaultConfig.search.minScoreThreshold,
    } as Partial<SniperConfig["search"]> as SniperConfig["search"],
    lanes,
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

function normalizeModernConfig(parsed: Record<string, unknown>): ConfigOverrides {
  const partial = parsed as ConfigOverrides;
  if (!partial.lanes) {
    return partial;
  }
  return {
    ...partial,
    lanes: Object.fromEntries(
      Object.entries(partial.lanes).map(([lane, value]) => [lane, value]),
    ) as Record<LaneId, Partial<LaneConfig>>,
    blacklist: partial.blacklist
      ? {
          ...partial.blacklist,
          lanes: partial.blacklist.lanes ?? {},
        }
      : undefined,
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
    parsed.lanes !== null;

  return looksModern
    ? mergeConfig(defaultConfig, normalizeModernConfig(parsed))
    : mergeConfig(defaultConfig, migrateLegacyConfig(parsed));
}

export function saveConfig(baseDir: string, config: SniperConfig): void {
  ensureDir(baseDir);
  fs.writeFileSync(path.join(baseDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

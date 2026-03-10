import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./lib/paths.js";
import type { SniperConfig } from "./types.js";

const defaultConfig: SniperConfig = {
  search: {
    maxResultsPerQuery: 6,
    maxQueriesPerLane: 6,
    minScoreThreshold: 35,
    browserFallback: false,
    priorityCities: ["Istanbul", "İstanbul"],
    priorityCountries: ["Turkey", "Türkiye"],
  },
  lanes: {
    design_jobs: {
      enabled: true,
      queries: {
        tr: [
          "istanbul ui ux tasarim is ilani",
          "istanbul urun tasarimcisi figma kariyer",
          "turkiye tasarim sistemleri product designer remote",
        ],
        en: [
          "Istanbul product designer figma jobs",
          "Turkey UX UI designer careers",
          "remote product designer design systems jobs",
        ],
      },
      keywords: ["figma", "product design", "ui", "ux", "tasarım", "design system", "visual design"],
    },
    ai_coding_jobs: {
      enabled: true,
      queries: {
        tr: [
          "istanbul yapay zeka muhendisi is ilani",
          "turkiye llm engineer remote",
          "istanbul agent engineer typescript python kariyer",
        ],
        en: [
          "Istanbul AI engineer TypeScript jobs",
          "remote LLM engineer developer tools jobs",
          "agent engineer automation node python jobs",
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
      ],
    },
    company_watch: {
      enabled: true,
      queries: {
        tr: [
          "istanbul design studio careers",
          "istanbul ai startup careers",
        ],
        en: [
          "Istanbul AI startup careers",
          "Turkey product design company careers",
        ],
      },
      keywords: ["careers", "jobs", "team", "hiring", "designer", "ai"],
    },
  },
  sources: {
    rss: [
      { name: "Berlin Startup Jobs Design", url: "https://berlinstartupjobs.com/design/feed/" },
      { name: "Berlin Startup Jobs Engineering", url: "https://berlinstartupjobs.com/engineering/feed/" },
    ],
    atsBoards: [],
  },
  blacklist: {
    companies: [],
    keywords: ["senior", "principal", "staff", "manager", "head of", "director", "vp", "founder", "co-founder", "cofounder", "founding"],
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
    },
  },
};

function mergeConfig(base: SniperConfig, overrides: Partial<SniperConfig>): SniperConfig {
  return {
    ...base,
    ...overrides,
    search: { ...base.search, ...(overrides.search ?? {}) },
    lanes: {
      design_jobs: { ...base.lanes.design_jobs, ...(overrides.lanes?.design_jobs ?? {}) },
      ai_coding_jobs: { ...base.lanes.ai_coding_jobs, ...(overrides.lanes?.ai_coding_jobs ?? {}) },
      company_watch: { ...base.lanes.company_watch, ...(overrides.lanes?.company_watch ?? {}) },
    },
    sources: {
      rss: overrides.sources?.rss ?? base.sources.rss,
      atsBoards: overrides.sources?.atsBoards ?? base.sources.atsBoards,
    },
    blacklist: {
      companies: overrides.blacklist?.companies ?? base.blacklist.companies,
      keywords: overrides.blacklist?.keywords ?? base.blacklist.keywords,
      lanes: {
        design_jobs: overrides.blacklist?.lanes?.design_jobs ?? base.blacklist.lanes.design_jobs,
        ai_coding_jobs:
          overrides.blacklist?.lanes?.ai_coding_jobs ?? base.blacklist.lanes.ai_coding_jobs,
        company_watch:
          overrides.blacklist?.lanes?.company_watch ?? base.blacklist.lanes.company_watch,
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
  const sourceBlock = raw.sources;
  const sources = Array.isArray(sourceBlock)
    ? (sourceBlock as Array<Record<string, unknown>>)
    : Array.isArray((sourceBlock as { rss?: unknown } | undefined)?.rss)
      ? (((sourceBlock as { rss?: unknown }).rss as Array<Record<string, unknown>>) ?? [])
      : [];
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
      design_jobs: { keywords: includeKeywords },
      ai_coding_jobs: { keywords: includeKeywords },
      company_watch: { keywords: includeKeywords },
    } as Partial<SniperConfig["lanes"]> as SniperConfig["lanes"],
    sources: {
      rss: sources
        .filter((entry) => entry.type === "rss" && typeof entry.url === "string")
        .map((entry) => ({
          name: String(entry.name ?? entry.url),
          url: String(entry.url),
        })),
      atsBoards: [],
    },
    blacklist: {
      companies: Array.isArray(blacklist.companies)
        ? blacklist.companies.filter((entry): entry is string => typeof entry === "string")
        : [],
      keywords: excludeKeywords.length ? excludeKeywords : defaultConfig.blacklist.keywords,
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

  if (looksModern) {
    return mergeConfig(defaultConfig, parsed as Partial<SniperConfig>);
  }

  const migrated = migrateLegacyConfig(parsed);
  return mergeConfig(defaultConfig, migrated);
}

export function saveConfig(baseDir: string, config: SniperConfig): void {
  ensureDir(baseDir);
  fs.writeFileSync(path.join(baseDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

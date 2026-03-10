import { includesAny, normalizeText, pickTopSignals } from "./lib/text.js";
import type { Category, ListingCandidate, ProfileSummary, SearchLane, SniperConfig } from "./types.js";

const LANE_SIGNALS: Record<SearchLane, string[]> = {
  design_jobs: ["product design", "product designer", "ux", "ui", "figma", "design systems", "visual"],
  ai_coding_jobs: [
    "ai engineer",
    "llm",
    "agent",
    "automation",
    "typescript",
    "node",
    "python",
    "developer tools",
  ],
  company_watch: ["careers", "jobs", "hiring", "team"],
};

function categoryFromScore(score: number): Category {
  if (score >= 70) {
    return "Good Match";
  }
  if (score >= 55) {
    return "Mid Match";
  }
  return "Low Match";
}

const ALWAYS_EXCLUDE_TITLE_TERMS = [
  "senior",
  "sr",
  "lead",
  "principal",
  "staff",
  "manager",
  "head of",
  "director",
  "vp",
  "founder",
  "co-founder",
  "cofounder",
  "founding",
  "no longer accepting applications",
  "no longer available",
  "applications closed",
  "application closed",
  "position filled",
  "job expired",
  "role expired",
  "no longer hiring",
];

export function isBlacklisted(config: SniperConfig, listing: ListingCandidate): boolean {
  const combined = normalizeText(
    `${listing.company} ${listing.title} ${listing.description} ${listing.location} ${listing.url}`,
  );
  const laneTerms = config.blacklist.lanes[listing.lane] ?? [];

  if (ALWAYS_EXCLUDE_TITLE_TERMS.some((term) => combined.includes(normalizeText(term)))) {
    return true;
  }

  return [...config.blacklist.keywords, ...laneTerms].some((term) =>
    combined.includes(normalizeText(term)),
  ) || config.blacklist.companies.some((company) =>
    normalizeText(listing.company).includes(normalizeText(company)),
  );
}

export function scoreListing(
  config: SniperConfig,
  profile: ProfileSummary,
  listing: ListingCandidate,
): { score: number; category: Category; rationale: string; relevantProjects: string[] } {
  if (isBlacklisted(config, listing)) {
    return {
      score: 0,
      category: "Excluded",
      rationale: "Excluded by company or keyword blacklist.",
      relevantProjects: [],
    };
  }

  const haystack = normalizeText(
    `${listing.title} ${listing.description} ${listing.company} ${listing.location} ${listing.language} ${listing.workModel}`,
  );

  let score = 0;
  const reasons: string[] = [];
  const laneSignals = LANE_SIGNALS[listing.lane];
  const profileSignals = profile.toolSignals;
  const laneMatches = pickTopSignals(haystack, [...laneSignals, ...config.lanes[listing.lane].keywords], 6);
  const profileMatches = pickTopSignals(haystack, profileSignals, 5);

  if (laneMatches.length) {
    score += Math.min(35, laneMatches.length * 7);
    reasons.push(`Lane fit: ${laneMatches.join(", ")}`);
  }

  if (profileMatches.length) {
    score += Math.min(30, profileMatches.length * 6);
    reasons.push(`Profile signals: ${profileMatches.join(", ")}`);
  }

  if (includesAny(haystack, ["istanbul", "i̇stanbul", "turkiye", "türkiye", "turkey"])) {
    score += 18;
    reasons.push("Location matches Istanbul/Turkey preference.");
  } else if (listing.workModel === "remote") {
    score += 10;
    reasons.push("Remote role kept in the secondary global lane.");
  }

  if (listing.language === "tr" || includesAny(haystack, ["turkce", "türkçe"])) {
    score += 8;
    reasons.push("Turkish-language signal detected.");
  } else if (listing.language === "en") {
    score += 4;
    reasons.push("English-language role remains eligible.");
  }

  if (profile.seniorityCeiling === "mid" && includesAny(haystack, ["senior", "principal", "staff", "lead"])) {
    score -= 20;
    reasons.push("Seniority is above the current target band.");
  }

  if (includesAny(haystack, ["intern", "staj", "contractor only"])) {
    score -= 10;
    reasons.push("Role shape is less aligned.");
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    category: categoryFromScore(score),
    rationale: reasons.join(" "),
    relevantProjects: [...new Set([...laneMatches, ...profileMatches])].slice(0, 5),
  };
}

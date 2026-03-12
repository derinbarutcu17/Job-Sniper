import { extractYearRequirement, findFirstMatch, includesAny, normalizeText, pickTopSignals } from "./lib/text.js";
import type {
  Category,
  ListingCandidate,
  ProfileSummary,
  ScoreBreakdown,
  SearchLane,
  SniperConfig,
} from "./types.js";

const TITLE_FAMILY_MAP: Array<{ family: string; terms: string[] }> = [
  { family: "Product Designer", terms: ["product designer", "ürün tasarımcısı", "product design"] },
  { family: "UI/UX Designer", terms: ["ui/ux designer", "ux designer", "ui designer", "ux", "ui"] },
  { family: "Design Engineer", terms: ["design engineer", "creative technologist"] },
  { family: "Frontend Engineer", terms: ["frontend engineer", "front-end engineer", "react developer"] },
  { family: "AI Engineer", terms: ["ai engineer", "ml engineer", "llm engineer"] },
  { family: "Automation Engineer", terms: ["automation engineer", "agent engineer"] },
  { family: "GenAI Product Builder", terms: ["genai", "agent workflows", "ai product"] },
];

const ALWAYS_EXCLUDE_TITLE_TERMS = [
  "senior",
  "lead",
  "manager",
  "director",
  "head",
  "vp",
  "principal",
  "staff",
  "founder",
  "founding",
  "co-founder",
  "cofounder",
  "cto",
  "cso",
  "chief ",
  "architect",
];
const HEAVY_MISMATCH_TERMS = [
  "customer success",
  "sales manager",
  "growth partner",
  "account executive",
  "business development",
  "legal",
  "commission-only",
  "devops",
  "kubernetes",
  "golang",
  "backend",
  "machine learning intern",
];
const CLOSED_ROLE_TERMS = [
  "applications closed",
  "application closed",
  "position filled",
  "job expired",
  "role expired",
  "no longer hiring",
  "no longer accepting applications",
];

function categoryFromScore(score: number): Category {
  if (score >= 75) return "Good Match";
  if (score >= 55) return "Mid Match";
  return "Low Match";
}

export function normalizeTitleFamily(text: string): string {
  const normalized = normalizeText(text);
  return (
    TITLE_FAMILY_MAP.find((entry) => entry.terms.some((term) => normalized.includes(normalizeText(term))))?.family ??
    "Other"
  );
}

function gateEligibility(config: SniperConfig, profile: ProfileSummary, listing: ListingCandidate): ScoreBreakdown {
  const title = normalizeText(listing.title);
  const description = normalizeText(listing.description);
  const breakdown: ScoreBreakdown = {
    titleFit: 0,
    skillFit: 0,
    seniorityFit: 0,
    locationFit: 0,
    workModelFit: 0,
    languageFit: 0,
    companyFit: 0,
    startupFit: 0,
    freshnessFit: 0,
    contactabilityFit: 0,
    sourceQualityFit: 0,
    positives: [],
    negatives: [],
    gatesPassed: [],
    gatesFailed: [],
  };

  if (config.blacklist.companies.some((company) => normalizeText(listing.company).includes(normalizeText(company)))) {
    breakdown.gatesFailed.push("company_blacklist");
  }

  if (
    ALWAYS_EXCLUDE_TITLE_TERMS.some((term) => title.includes(normalizeText(term))) ||
    profile.avoidTitleTerms.some((term) => title.includes(normalizeText(term)))
  ) {
    breakdown.gatesFailed.push("title_seniority");
    breakdown.negatives.push(`Title contains excluded seniority term: ${findFirstMatch(title, [...ALWAYS_EXCLUDE_TITLE_TERMS, ...profile.avoidTitleTerms])}`);
  } else {
    breakdown.gatesPassed.push("title_seniority");
  }

  if (CLOSED_ROLE_TERMS.some((term) => description.includes(normalizeText(term)) || title.includes(normalizeText(term)))) {
    breakdown.gatesFailed.push("job_closed");
    breakdown.negatives.push("Role appears closed or expired.");
  } else {
    breakdown.gatesPassed.push("job_open");
  }

  if (HEAVY_MISMATCH_TERMS.some((term) => title.includes(normalizeText(term)) || description.includes(normalizeText(term)))) {
    breakdown.gatesFailed.push("role_family_mismatch");
    breakdown.negatives.push(`Role family mismatch: ${findFirstMatch(`${title} ${description}`, HEAVY_MISMATCH_TERMS)}`);
  } else {
    breakdown.gatesPassed.push("role_family_fit");
  }

  return breakdown;
}

function laneSignals(lane: SearchLane): string[] {
  switch (lane) {
    case "design_jobs":
      return ["product designer", "ux", "ui", "figma", "design systems", "creative technologist", "design engineer"];
    case "ai_coding_jobs":
      return ["ai engineer", "llm", "agent", "automation", "typescript", "node", "python", "developer tools"];
    case "company_watch":
      return ["careers", "hiring", "team", "startup", "founding"];
  }
}

export function scoreListing(
  config: SniperConfig,
  profile: ProfileSummary,
  listing: ListingCandidate,
): { score: number; category: Category; rationale: string; relevantProjects: string[]; breakdown: ScoreBreakdown; eligibility: string; titleFamily: string } {
  const breakdown = gateEligibility(config, profile, listing);
  if (breakdown.gatesFailed.length) {
    return {
      score: 0,
      category: "Excluded",
      rationale: breakdown.negatives.join(" "),
      relevantProjects: [],
      breakdown,
      eligibility: "excluded",
      titleFamily: normalizeTitleFamily(listing.title),
    };
  }

  const titleFamily = normalizeTitleFamily(`${listing.title} ${listing.description}`);
  const titleBlob = normalizeText(`${listing.title} ${titleFamily}`);
  const descriptionBlob = normalizeText(`${listing.description} ${listing.location} ${listing.language}`);
  const allBlob = `${titleBlob} ${descriptionBlob}`;

  const titleMatches = pickTopSignals(titleBlob, laneSignals(listing.lane), 5);
  breakdown.titleFit = Math.min(18, titleMatches.length * 6);
  if (titleMatches.length) {
    breakdown.positives.push(`Title family fit: ${titleMatches.join(", ")}`);
    breakdown.gatesPassed.push("title_family");
  }

  const profileMatches = pickTopSignals(allBlob, profile.toolSignals, 6);
  breakdown.skillFit = Math.min(20, profileMatches.length * 4);
  if (profileMatches.length) {
    breakdown.positives.push(`Skill overlap: ${profileMatches.join(", ")}`);
  }

  const requiredYears = extractYearRequirement(listing.description);
  if (profile.targetSeniority === "junior") {
    if (requiredYears && /\b([5-9]|1\d)\b/.test(requiredYears)) {
      breakdown.seniorityFit -= 20;
      breakdown.negatives.push(`Experience ask too high: ${requiredYears}`);
    } else {
      breakdown.seniorityFit += 10;
      breakdown.gatesPassed.push("seniority");
    }
  } else if (profile.allowStretchRoles) {
    breakdown.seniorityFit += 6;
  }

  if (includesAny(allBlob, config.search.priorityCities) || includesAny(allBlob, profile.preferredLocations)) {
    breakdown.locationFit += 16;
    breakdown.positives.push("Matches target city.");
  } else if (listing.workModel === "remote") {
    breakdown.locationFit += 8;
    breakdown.positives.push("Remote role kept in target funnel.");
  } else if (listing.workModel === "onsite") {
    breakdown.locationFit -= 10;
    breakdown.negatives.push("Onsite role outside preferred zone.");
  }

  if (listing.workModel === "hybrid" || listing.workModel === "remote") {
    breakdown.workModelFit += 8;
  }

  if (profile.languagePreference.includes(listing.language)) {
    breakdown.languageFit += 6;
  } else if (listing.language) {
    breakdown.languageFit -= 4;
    breakdown.negatives.push(`Language mismatch: ${listing.language}`);
  }

  if (includesAny(allBlob, ["seed", "series a", "founding", "small team", "0-1"])) {
    breakdown.startupFit += 10;
    breakdown.positives.push("Startup/early-team signal.");
  }

  if (listing.publicContacts.some((contact) => contact.confidence === "high")) {
    breakdown.contactabilityFit += 12;
  } else if (listing.publicContacts.length) {
    breakdown.contactabilityFit += 6;
  }

  if (listing.parseConfidence >= 0.7) {
    breakdown.sourceQualityFit += 6;
  }
  if (listing.postedAt) {
    breakdown.freshnessFit += 4;
  }

  if (includesAny(descriptionBlob, config.blacklist.softPenaltyTerms)) {
    breakdown.negatives.push("Description contains management-heavy language.");
    breakdown.companyFit -= 8;
  }
  if (includesAny(descriptionBlob, config.blacklist.keywords)) {
    breakdown.companyFit -= 15;
    breakdown.negatives.push("Out-of-scope role family detected.");
  }

  const score =
    breakdown.titleFit +
    breakdown.skillFit +
    breakdown.seniorityFit +
    breakdown.locationFit +
    breakdown.workModelFit +
    breakdown.languageFit +
    breakdown.companyFit +
    breakdown.startupFit +
    breakdown.freshnessFit +
    breakdown.contactabilityFit +
    breakdown.sourceQualityFit;

  const relevantProjects = [...new Set([...titleMatches, ...profileMatches])].slice(0, 5);
  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    category: categoryFromScore(boundedScore),
    rationale: [...breakdown.positives, ...breakdown.negatives].join(" "),
    relevantProjects,
    breakdown,
    eligibility: boundedScore >= config.search.minScoreThreshold ? "eligible" : "soft_filtered",
    titleFamily,
  };
}

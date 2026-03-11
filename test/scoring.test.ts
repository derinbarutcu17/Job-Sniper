import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { scoreListing } from "../src/scoring.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";
import { makeTempDir } from "./helpers.js";

const profile: ProfileSummary = {
  roleFamilies: ["design", "ai_coding"],
  targetSeniority: "junior",
  allowStretchRoles: false,
  avoidTitleTerms: ["senior", "lead", "manager", "director", "head", "principal", "staff"],
  preferredLocations: ["Istanbul", "Remote"],
  languagePreference: ["tr", "en"],
  toolSignals: ["figma", "design systems", "typescript", "python", "agent"],
  summary: "Product-focused design and AI tooling profile.",
};

function listing(partial: Partial<ListingCandidate>): ListingCandidate {
  return {
    lane: "design_jobs",
    externalId: "listing-1",
    title: "Product Designer",
    titleFamily: "",
    company: "ModaAI",
    location: "Istanbul",
    country: "Turkey",
    language: "tr",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma, design systems, UX, and product design role in Istanbul.",
    url: "https://jobs.example.com/designer",
    applyUrl: "https://jobs.example.com/designer",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/designer"],
    companyUrl: "https://moda.ai",
    careersUrl: "https://moda.ai/careers",
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
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
    parseConfidence: 0.8,
    sourceConfidence: 0.8,
    isRealJobPage: true,
    raw: {},
    ...partial,
  };
}

describe("scoring", () => {
  it("prioritizes Turkish Istanbul design roles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(config, profile, listing({}));
    expect(scored.score).toBeGreaterThan(55);
    expect(scored.category).not.toBe("Excluded");
  });

  it("keeps manager mentions in description as soft negatives, not hard excludes", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({
        description: "Product Designer reporting to a Design Manager with stakeholder management across product teams.",
      }),
    );
    expect(scored.category).not.toBe("Excluded");
    expect(scored.breakdown.negatives.some((entry) => entry.toLowerCase().includes("management"))).toBe(true);
  });

  it("hard excludes senior titles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(config, profile, listing({ title: "Senior Product Designer" }));
    expect(scored.category).toBe("Excluded");
    expect(scored.eligibility).toBe("excluded");
  });

  it("excludes closed roles from explicit closure text", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({ description: "Applications closed. This role is no longer hiring." }),
    );
    expect(scored.category).toBe("Excluded");
  });
});

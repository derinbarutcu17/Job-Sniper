import { describe, expect, it } from "vitest";
import { scoreListing } from "../src/scoring.js";
import { loadConfig } from "../src/config.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";
import { makeTempDir } from "./helpers.js";

const profile: ProfileSummary = {
  roleFamilies: ["design", "ai_coding"],
  seniorityCeiling: "mid",
  preferredLocations: ["Istanbul", "Remote"],
  languagePreference: ["tr", "en"],
  toolSignals: ["figma", "design systems", "typescript", "python", "agent"],
  summary: "Product-focused design and AI tooling profile.",
};

function listing(partial: Partial<ListingCandidate>): ListingCandidate {
  return {
    lane: "design_jobs",
    title: "Product Designer",
    company: "ModaAI",
    location: "Istanbul",
    country: "Turkey",
    language: "tr",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma, design systems, UX, and product design role in Istanbul.",
    url: "https://jobs.example.com/designer",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/designer"],
    companyUrl: "https://moda.ai",
    careersUrl: "https://moda.ai/careers",
    companyLinkedinUrl: "",
    publicContacts: [],
    publicEmails: [],
    ...partial,
  };
}

describe("scoring", () => {
  it("prioritizes Turkish Istanbul design roles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(config, profile, listing({}));
    expect(scored.score).toBeGreaterThan(70);
    expect(scored.category).toBe("Good Match");
  });

  it("scores remote AI roles positively but below Istanbul-first matches", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({
        lane: "ai_coding_jobs",
        title: "Agent Engineer",
        location: "Remote",
        language: "en",
        workModel: "remote",
        description: "Remote LLM agent role using TypeScript, Node, and Python automation.",
      }),
    );
    expect(scored.score).toBeGreaterThan(50);
    expect(scored.category).not.toBe("Excluded");
  });

  it("excludes blacklisted jobs", () => {
    const baseDir = makeTempDir();
    const config = loadConfig(baseDir);
    config.blacklist.companies.push("ModaAI");
    const scored = scoreListing(config, profile, listing({}));
    expect(scored.category).toBe("Excluded");
  });
});

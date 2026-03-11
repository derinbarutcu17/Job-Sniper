import { describe, expect, it } from "vitest";
import { deriveProfileSummary } from "../src/profile.js";

describe("profile seniority parsing", () => {
  it("treats explicit no-senior wording as junior target", () => {
    const profile = deriveProfileSummary(
      "İstanbul based designer. No Senior/Lead roles. Looking for junior or associate product design opportunities.",
    );
    expect(profile.targetSeniority).toBe("junior");
    expect(profile.allowStretchRoles).toBe(false);
    expect(profile.avoidTitleTerms).toContain("senior");
  });

  it("recognizes leadership and years as senior", () => {
    const profile = deriveProfileSummary(
      "5+ years leading teams across product and engineering. Lead engineer focused on AI product delivery.",
    );
    expect(profile.targetSeniority).toBe("senior");
    expect(profile.allowStretchRoles).toBe(true);
  });
});

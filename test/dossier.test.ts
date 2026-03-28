import { describe, expect, it } from "vitest";
import { renderCompanyDossier } from "../src/company-dossier.js";

describe("company dossier", () => {
  it("summarizes route, priority, and roles", () => {
    const output = renderCompanyDossier(
      {
        id: 1,
        name: "North",
        startup_score: 12,
        company_fit_score: 8,
        contactability_score: 10,
        open_role_count: 2,
        team_url: "https://north.example.com/team",
      },
      [{ title: "Design Engineer", recommendation: "cold_email", pitch_theme: "design_engineering", pitch_angle: "Lead with hybrid design and code." }],
      [{ email: "hello@north.example.com" }],
    );
    expect(output).toContain("Recommendation:");
    expect(output).toContain("Best route:");
    expect(output).toContain("Design Engineer");
  });
});


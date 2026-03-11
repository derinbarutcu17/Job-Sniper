import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDatabase, recordRunMetrics, upsertJob } from "../src/db.js";
import { pullSheets, syncSheets, type SheetGateway } from "../src/sheets.js";
import type { ListingCandidate, ProfileSummary, SniperConfig } from "../src/types.js";
import { makeTempDir } from "./helpers.js";

class FakeSheetGateway implements SheetGateway {
  public readonly sheets = new Map<string, Array<Record<string, string>>>();
  public readonly headers = new Map<string, string[]>();

  async createSpreadsheet(): Promise<string> {
    return "sheet-123";
  }

  async ensureSheet(_spreadsheetId: string, title: string): Promise<void> {
    if (!this.sheets.has(title)) {
      this.sheets.set(title, []);
    }
  }

  async readSheet(_spreadsheetId: string, title: string): Promise<Array<Record<string, string>>> {
    return this.sheets.get(title) ?? [];
  }

  async writeSheet(
    _spreadsheetId: string,
    title: string,
    rows: Array<Record<string, string>>,
    headers: string[] = [],
  ): Promise<void> {
    this.sheets.set(title, rows);
    this.headers.set(title, headers);
  }
}

function profile(): ProfileSummary {
  return {
    roleFamilies: ["design"],
    targetSeniority: "junior",
    allowStretchRoles: false,
    avoidTitleTerms: ["senior", "lead", "manager"],
    preferredLocations: ["Istanbul"],
    languagePreference: ["tr", "en"],
    toolSignals: ["figma"],
    summary: "designer",
  };
}

function listing(): ListingCandidate {
  return {
    lane: "design_jobs",
    externalId: "1",
    title: "Product Designer",
    titleFamily: "Product Designer",
    company: "ModaAI",
    location: "Istanbul",
    country: "Turkey",
    language: "tr",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma role",
    url: "https://jobs.example.com/design-1",
    applyUrl: "https://jobs.example.com/design-1",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/design-1"],
    companyUrl: "https://moda.ai",
    careersUrl: "https://moda.ai/careers",
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: "2026-03-11",
    validThrough: "",
    department: "",
    experienceYearsText: "",
    remoteScope: "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.9,
    sourceConfidence: 0.8,
    isRealJobPage: true,
    raw: {},
  };
}

describe("sheets sync", () => {
  it("creates full schema and preserves manual columns on repeat sync", async () => {
    const baseDir = makeTempDir();
    const gateway = new FakeSheetGateway();
    const { db } = openDatabase(baseDir);
    const config: SniperConfig = loadConfig(baseDir);
    const prof = profile();

    upsertJob(
      db,
      config,
      listing(),
      82,
      "Good Match",
      "Strong fit",
      ["figma"],
      prof,
      {
        titleFit: 10,
        skillFit: 10,
        seniorityFit: 10,
        locationFit: 10,
        workModelFit: 10,
        languageFit: 10,
        companyFit: 0,
        startupFit: 0,
        freshnessFit: 0,
        contactabilityFit: 0,
        sourceQualityFit: 0,
        positives: ["figma"],
        negatives: [],
        gatesPassed: ["title_family"],
        gatesFailed: [],
      },
      "eligible",
    );

    recordRunMetrics(
      db,
      {
        totalFound: 1,
        totalNew: 1,
        totalUpdated: 0,
        excluded: 0,
        companiesTouched: 1,
        contactsTouched: 0,
        deduped: 0,
        parsed: 1,
        fetchSuccessRate: 1,
        parseSuccessRate: 1,
        jsFallbackRate: 0,
      },
      { duckduckgo: 1 },
    );

    const first = await syncSheets(baseDir, gateway);
    const jobsTab = gateway.sheets.get("Jobs") ?? [];
    jobsTab[0]!.owner_notes = "call founder";
    gateway.sheets.set("Jobs", jobsTab);

    const second = await syncSheets(baseDir, gateway);
    const after = gateway.sheets.get("Jobs") ?? [];

    expect(first.spreadsheetId).toBe("sheet-123");
    expect(second.spreadsheetId).toBe("sheet-123");
    expect(gateway.headers.get("Jobs")).toContain("canonical_key");
    expect(gateway.headers.get("Jobs")).toContain("manual_status");
    expect(gateway.headers.get("RunMetrics")).toContain("total_discovered");
    expect(after).toHaveLength(1);
    expect(after[0]?.owner_notes).toBe("call founder");
  });

  it("pulls manual columns back into sqlite by canonical key", async () => {
    const baseDir = makeTempDir();
    const gateway = new FakeSheetGateway();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO jobs (
        canonical_key, company_name, title, created_at, updated_at
      ) VALUES (
        'job:test-1', 'ModaAI', 'Product Designer', datetime('now'), datetime('now')
      )
    `);
    gateway.sheets.set("Jobs", [
      {
        canonical_key: "job:test-1",
        owner_notes: "follow up next week",
        manual_status: "interested",
        priority: "high",
        outreach_state: "ready",
        manual_contact_override: "founder@moda.ai",
      },
    ]);

    process.env.SNIPER_GOOGLE_SHEET_ID = "sheet-123";
    const result = await pullSheets(baseDir, gateway);
    const job = db
      .prepare("SELECT owner_notes, manual_status, priority, manual_contact_override FROM jobs WHERE canonical_key = 'job:test-1'")
      .get() as { owner_notes: string; manual_status: string; priority: string; manual_contact_override: string };

    expect(result.pulled).toBe(1);
    expect(job.owner_notes).toBe("follow up next week");
    expect(job.manual_status).toBe("interested");
    expect(job.priority).toBe("high");
    expect(job.manual_contact_override).toBe("founder@moda.ai");
    delete process.env.SNIPER_GOOGLE_SHEET_ID;
  });
});

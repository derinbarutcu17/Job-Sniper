import { describe, expect, it } from "vitest";
import { openDatabase, upsertCompany, upsertJob } from "../src/db.js";
import { pullSheets, syncSheets, type SheetGateway } from "../src/sheets.js";
import type { ProfileSummary, SniperConfig } from "../src/types.js";
import { loadConfig } from "../src/config.js";
import { makeTempDir } from "./helpers.js";

class FakeSheetGateway implements SheetGateway {
  public readonly sheets = new Map<string, Array<Record<string, string>>>();

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

  async writeSheet(_spreadsheetId: string, title: string, rows: Array<Record<string, string>>): Promise<void> {
    this.sheets.set(title, rows);
  }
}

describe("sheets sync", () => {
  it("upserts rows and preserves manual columns on repeat sync", async () => {
    const baseDir = makeTempDir();
    const gateway = new FakeSheetGateway();
    const { db } = openDatabase(baseDir);
    const config: SniperConfig = loadConfig(baseDir);
    const profile: ProfileSummary = {
      roleFamilies: ["design"],
      seniorityCeiling: "mid",
      preferredLocations: ["Istanbul"],
      languagePreference: ["tr", "en"],
      toolSignals: ["figma"],
      summary: "designer",
    };

    upsertCompany(db, {
      canonicalKey: "company:moda-ai",
      name: "ModaAI",
      domain: "moda.ai",
      location: "Istanbul",
      companyUrl: "https://moda.ai",
      careersUrl: "https://moda.ai/careers",
      linkedinUrl: "",
      description: "",
      sourceUrls: ["https://moda.ai/careers"],
      publicContacts: [],
      lastSeenAt: new Date().toISOString(),
    });

    upsertJob(
      db,
      config,
      {
        lane: "design_jobs",
        externalId: "1",
        title: "Product Designer",
        company: "ModaAI",
        location: "Istanbul",
        country: "Turkey",
        language: "tr",
        workModel: "hybrid",
        employmentType: "full-time",
        salary: "",
        description: "Figma role",
        url: "https://jobs.example.com/design-1",
        source: "test",
        sourceType: "page",
        sourceUrls: ["https://jobs.example.com/design-1"],
        companyUrl: "https://moda.ai",
        careersUrl: "https://moda.ai/careers",
        companyLinkedinUrl: "",
        publicContacts: [],
        publicEmails: [],
      },
      82,
      "Good Match",
      "Strong fit",
      ["figma"],
      profile,
    );

    const first = await syncSheets(baseDir, gateway);
    const jobsTab = gateway.sheets.get("Jobs") ?? [];
    jobsTab[0]!.owner_notes = "call founder";
    gateway.sheets.set("Jobs", jobsTab);

    const second = await syncSheets(baseDir, gateway);
    const after = gateway.sheets.get("Jobs") ?? [];

    expect(first.spreadsheetId).toBe("sheet-123");
    expect(second.spreadsheetId).toBe("sheet-123");
    expect(after).toHaveLength(1);
    expect(after[0]?.owner_notes).toBe("call founder");
  });

  it("pulls manual columns back into sqlite", async () => {
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
      .prepare("SELECT owner_notes, manual_status, priority FROM jobs WHERE canonical_key = 'job:test-1'")
      .get() as { owner_notes: string; manual_status: string; priority: string };

    expect(result.pulled).toBe(1);
    expect(job.owner_notes).toBe("follow up next week");
    expect(job.manual_status).toBe("interested");
    expect(job.priority).toBe("high");
    delete process.env.SNIPER_GOOGLE_SHEET_ID;
  });
});

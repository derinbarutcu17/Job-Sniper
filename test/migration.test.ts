import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { makeTempDir } from "./helpers.js";

describe("legacy migration", () => {
  it("migrates the legacy jobs table into normalized tables", () => {
    const baseDir = makeTempDir();
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const legacy = new Database(path.join(baseDir, "data", "sniper.db"));
    legacy.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE,
        title TEXT,
        company TEXT,
        location TEXT,
        salary TEXT,
        description TEXT,
        url TEXT,
        source TEXT,
        status TEXT DEFAULT 'new',
        category TEXT DEFAULT 'Low Match',
        match_score INTEGER DEFAULT 0,
        match_rationale TEXT,
        relevant_projects TEXT,
        discovery_logic TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    legacy
      .prepare(
        "INSERT INTO jobs (external_id, title, company, location, description, url, source, match_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-1",
        "Product Designer",
        "ModaAI",
        "Istanbul",
        "Figma and design systems",
        "https://jobs.example.com/designer-1",
        "legacy-rss",
        88,
      );
    legacy.close();

    const { db } = openDatabase(baseDir);
    const job = db.prepare("SELECT * FROM jobs").get() as { title: string; company_name: string; score: number };
    const company = db.prepare("SELECT * FROM companies").get() as { name: string };
    const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    const companyColumns = db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
    const contactLogTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contact_log'").get() as { name: string } | undefined;
    const outcomeLogTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outcome_log'").get() as { name: string } | undefined;

    expect(job.title).toBe("Product Designer");
    expect(job.company_name).toBe("ModaAI");
    expect(job.score).toBe(88);
    expect(company.name).toBe("ModaAI");
    expect(jobColumns.some((column) => column.name === "recommendation")).toBe(true);
    expect(companyColumns.some((column) => column.name === "best_route")).toBe(true);
    expect(contactLogTable?.name).toBe("contact_log");
    expect(outcomeLogTable?.name).toBe("outcome_log");
  });
});

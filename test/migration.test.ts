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

    expect(job.title).toBe("Product Designer");
    expect(job.company_name).toBe("ModaAI");
    expect(job.score).toBe(88);
    expect(company.name).toBe("ModaAI");
  });
});

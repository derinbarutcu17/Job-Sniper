import fs from "node:fs";
import Database from "better-sqlite3";
import { resolveDataPath } from "./lib/paths.js";
import { canonicalCompanyKey, canonicalContactKey, canonicalJobKey, domainFromUrl } from "./lib/url.js";
import { uniqueNonEmpty } from "./lib/text.js";
import type {
  Category,
  CompanyRecordInput,
  ContactRecordInput,
  JobRecord,
  ListingCandidate,
  ProfileSummary,
  RunSummary,
  SearchLane,
  SniperConfig,
} from "./types.js";

export interface DatabaseBundle {
  db: Database.Database;
  baseDir: string;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      domain TEXT DEFAULT '',
      location TEXT DEFAULT '',
      company_url TEXT DEFAULT '',
      careers_url TEXT DEFAULT '',
      linkedin_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      source_urls TEXT DEFAULT '[]',
      public_contacts TEXT DEFAULT '[]',
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      company_id INTEGER,
      name TEXT DEFAULT '',
      title TEXT DEFAULT '',
      email TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      linkedin_url TEXT DEFAULT '',
      kind TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      external_id TEXT DEFAULT '',
      company_id INTEGER,
      company_name TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT DEFAULT '',
      country TEXT DEFAULT '',
      language TEXT DEFAULT '',
      work_model TEXT DEFAULT 'unknown',
      employment_type TEXT DEFAULT '',
      salary TEXT DEFAULT '',
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      source TEXT DEFAULT '',
      source_type TEXT DEFAULT 'page',
      lane TEXT DEFAULT 'ai_coding_jobs',
      status TEXT DEFAULT 'new',
      category TEXT DEFAULT 'Low Match',
      score REAL DEFAULT 0,
      match_rationale TEXT DEFAULT '',
      relevant_projects TEXT DEFAULT '',
      outreach_draft TEXT DEFAULT '',
      public_contacts TEXT DEFAULT '[]',
      source_urls TEXT DEFAULT '[]',
      raw_json TEXT DEFAULT '{}',
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      manual_status TEXT DEFAULT '',
      owner_notes TEXT DEFAULT '',
      priority TEXT DEFAULT '',
      outreach_state TEXT DEFAULT '',
      manual_contact_override TEXT DEFAULT '',
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS search_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lane TEXT NOT NULL,
      query TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      found_count INTEGER DEFAULT 0,
      new_count INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      error TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sheet_sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT UNIQUE NOT NULL,
      spreadsheet_id TEXT DEFAULT '',
      last_sync_at TEXT DEFAULT '',
      last_pull_at TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}'
    );
  `);
}

function migrateLegacyJobs(db: Database.Database): void {
  const legacyExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
    .get() as { name?: string } | undefined;

  if (!legacyExists) {
    createSchema(db);
    return;
  }

  if (hasColumn(db, "jobs", "canonical_key")) {
    createSchema(db);
    return;
  }

  db.exec("ALTER TABLE jobs RENAME TO legacy_jobs");
  createSchema(db);

  const rows = db.prepare("SELECT * FROM legacy_jobs").all() as Array<Record<string, unknown>>;
  const insertCompany = db.prepare(`
    INSERT OR IGNORE INTO companies (
      canonical_key, name, domain, location, company_url, careers_url, source_urls,
      public_contacts, last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @name, @domain, @location, @company_url, @careers_url, @source_urls,
      @public_contacts, @last_seen_at, @created_at, @updated_at
    )
  `);
  const selectCompany = db.prepare("SELECT id FROM companies WHERE canonical_key = ?");
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs (
      canonical_key, external_id, company_id, company_name, title, location, country, language,
      work_model, employment_type, salary, description, url, source, source_type, lane, status,
      category, score, match_rationale, relevant_projects, outreach_draft, public_contacts,
      source_urls, raw_json, last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @external_id, @company_id, @company_name, @title, @location, @country, @language,
      @work_model, @employment_type, @salary, @description, @url, @source, @source_type, @lane, @status,
      @category, @score, @match_rationale, @relevant_projects, @outreach_draft, @public_contacts,
      @source_urls, @raw_json, @last_seen_at, @created_at, @updated_at
    )
  `);

  for (const row of rows) {
    const companyName = String(row.company ?? "Unknown");
    const url = String(row.url ?? "");
    const domain = domainFromUrl(url);
    const companyKey = canonicalCompanyKey(companyName, domain);
    const timestamp = String(row.created_at ?? nowIso());

    insertCompany.run({
      canonical_key: companyKey,
      name: companyName,
      domain,
      location: String(row.location ?? ""),
      company_url: domain ? `https://${domain}` : "",
      careers_url: url,
      source_urls: JSON.stringify(uniqueNonEmpty([url])),
      public_contacts: JSON.stringify([]),
      last_seen_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const company = selectCompany.get(companyKey) as { id: number } | undefined;
    insertJob.run({
      canonical_key: canonicalJobKey(
        String(row.url ?? ""),
        String(row.external_id ?? ""),
        String(row.title ?? ""),
        companyName,
      ),
      external_id: String(row.external_id ?? ""),
      company_id: company?.id ?? null,
      company_name: companyName,
      title: String(row.title ?? "Untitled role"),
      location: String(row.location ?? ""),
      country: "",
      language: "en",
      work_model: "unknown",
      employment_type: "",
      salary: String(row.salary ?? ""),
      description: String(row.description ?? ""),
      url,
      source: String(row.source ?? "legacy"),
      source_type: "rss",
      lane: "ai_coding_jobs",
      status: String(row.status ?? "new"),
      category: String(row.category ?? "Low Match"),
      score: Number(row.match_score ?? 0),
      match_rationale: String(row.match_rationale ?? row.discovery_logic ?? ""),
      relevant_projects: String(row.relevant_projects ?? ""),
      outreach_draft: "",
      public_contacts: JSON.stringify([]),
      source_urls: JSON.stringify(uniqueNonEmpty([url])),
      raw_json: JSON.stringify(row),
      last_seen_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  db.prepare("INSERT OR IGNORE INTO migrations (name, executed_at) VALUES (?, ?)").run(
    "legacy_jobs_migration_v1",
    nowIso(),
  );
}

export function openDatabase(baseDir: string): DatabaseBundle {
  const dbPath = resolveDataPath(baseDir, "sniper.db");
  fs.mkdirSync(resolveDataPath(baseDir), { recursive: true });
  const db = new Database(dbPath);
  migrateLegacyJobs(db);
  createSchema(db);
  return { db, baseDir };
}

export function upsertCompany(db: Database.Database, input: CompanyRecordInput): number {
  const timestamp = input.lastSeenAt || nowIso();
  db.prepare(`
    INSERT INTO companies (
      canonical_key, name, domain, location, company_url, careers_url, linkedin_url, description,
      source_urls, public_contacts, last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @name, @domain, @location, @company_url, @careers_url, @linkedin_url, @description,
      @source_urls, @public_contacts, @last_seen_at, @created_at, @updated_at
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      name = excluded.name,
      domain = excluded.domain,
      location = CASE WHEN excluded.location != '' THEN excluded.location ELSE companies.location END,
      company_url = CASE WHEN excluded.company_url != '' THEN excluded.company_url ELSE companies.company_url END,
      careers_url = CASE WHEN excluded.careers_url != '' THEN excluded.careers_url ELSE companies.careers_url END,
      linkedin_url = CASE WHEN excluded.linkedin_url != '' THEN excluded.linkedin_url ELSE companies.linkedin_url END,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE companies.description END,
      source_urls = excluded.source_urls,
      public_contacts = excluded.public_contacts,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run({
    canonical_key: input.canonicalKey,
    name: input.name,
    domain: input.domain,
    location: input.location,
    company_url: input.companyUrl,
    careers_url: input.careersUrl,
    linkedin_url: input.linkedinUrl,
    description: input.description,
    source_urls: JSON.stringify(uniqueNonEmpty(input.sourceUrls)),
    public_contacts: JSON.stringify(uniqueNonEmpty(input.publicContacts)),
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const row = db.prepare("SELECT id FROM companies WHERE canonical_key = ?").get(input.canonicalKey) as {
    id: number;
  };
  return row.id;
}

export function upsertContact(db: Database.Database, input: ContactRecordInput): number {
  const companyId = db
    .prepare("SELECT id FROM companies WHERE canonical_key = ?")
    .get(input.companyCanonicalKey) as { id: number } | undefined;
  const timestamp = input.lastSeenAt || nowIso();

  db.prepare(`
    INSERT INTO contacts (
      canonical_key, company_id, name, title, email, source_url, linkedin_url, kind, notes,
      last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @company_id, @name, @title, @email, @source_url, @linkedin_url, @kind, @notes,
      @last_seen_at, @created_at, @updated_at
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE contacts.title END,
      email = CASE WHEN excluded.email != '' THEN excluded.email ELSE contacts.email END,
      source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE contacts.source_url END,
      linkedin_url = CASE WHEN excluded.linkedin_url != '' THEN excluded.linkedin_url ELSE contacts.linkedin_url END,
      kind = CASE WHEN excluded.kind != '' THEN excluded.kind ELSE contacts.kind END,
      notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE contacts.notes END,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run({
    canonical_key: input.canonicalKey,
    company_id: companyId?.id ?? null,
    name: input.name,
    title: input.title,
    email: input.email,
    source_url: input.sourceUrl,
    linkedin_url: input.linkedinUrl,
    kind: input.kind,
    notes: input.notes,
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const row = db.prepare("SELECT id FROM contacts WHERE canonical_key = ?").get(input.canonicalKey) as {
    id: number;
  };
  return row.id;
}

export function upsertJob(
  db: Database.Database,
  config: SniperConfig,
  listing: ListingCandidate,
  score: number,
  category: Category,
  rationale: string,
  relevantProjects: string[],
  profile: ProfileSummary,
): { inserted: boolean; updated: boolean; excluded: boolean } {
  const domain = domainFromUrl(listing.companyUrl || listing.url);
  const companyKey = canonicalCompanyKey(listing.company, domain);
  const companyId = upsertCompany(db, {
    canonicalKey: companyKey,
    name: listing.company,
    domain,
    location: listing.location,
    companyUrl: listing.companyUrl || (domain ? `https://${domain}` : ""),
    careersUrl: listing.careersUrl || listing.url,
    linkedinUrl: listing.companyLinkedinUrl,
    description: listing.description.slice(0, 5000),
    sourceUrls: listing.sourceUrls,
    publicContacts: listing.publicContacts,
    lastSeenAt: nowIso(),
  });

  for (const email of listing.publicEmails) {
    upsertContact(db, {
      canonicalKey: canonicalContactKey(email, "", email.split("@")[0] ?? "contact", companyKey),
      companyCanonicalKey: companyKey,
      name: email.split("@")[0] ?? "",
      title: "Public hiring contact",
      email,
      sourceUrl: listing.url,
      linkedinUrl: "",
      kind: "email",
      notes: "Discovered from public company/job page.",
      lastSeenAt: nowIso(),
    });
  }

  for (const contactUrl of listing.publicContacts) {
    upsertContact(db, {
      canonicalKey: canonicalContactKey("", contactUrl, contactUrl, companyKey),
      companyCanonicalKey: companyKey,
      name: "",
      title: "Public hiring/contact page",
      email: "",
      sourceUrl: listing.url,
      linkedinUrl: contactUrl.includes("linkedin.com") ? contactUrl : "",
      kind: "link",
      notes: contactUrl,
      lastSeenAt: nowIso(),
    });
  }

  const canonicalKey = canonicalJobKey(listing.url, listing.externalId ?? "", listing.title, listing.company);
  const existing = db.prepare("SELECT id FROM jobs WHERE canonical_key = ?").get(canonicalKey) as
    | { id: number }
    | undefined;
  const timestamp = nowIso();
  const inserted = !existing;
  const excluded = category === "Excluded" || score < config.search.minScoreThreshold;

  db.prepare(`
    INSERT INTO jobs (
      canonical_key, external_id, company_id, company_name, title, location, country, language,
      work_model, employment_type, salary, description, url, source, source_type, lane, status,
      category, score, match_rationale, relevant_projects, outreach_draft, public_contacts,
      source_urls, raw_json, last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @external_id, @company_id, @company_name, @title, @location, @country, @language,
      @work_model, @employment_type, @salary, @description, @url, @source, @source_type, @lane, @status,
      @category, @score, @match_rationale, @relevant_projects, @outreach_draft, @public_contacts,
      @source_urls, @raw_json, @last_seen_at, @created_at, @updated_at
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      title = excluded.title,
      location = excluded.location,
      country = excluded.country,
      language = excluded.language,
      work_model = excluded.work_model,
      employment_type = excluded.employment_type,
      salary = excluded.salary,
      description = excluded.description,
      url = excluded.url,
      source = excluded.source,
      source_type = excluded.source_type,
      lane = excluded.lane,
      status = excluded.status,
      category = excluded.category,
      score = excluded.score,
      match_rationale = excluded.match_rationale,
      relevant_projects = excluded.relevant_projects,
      public_contacts = excluded.public_contacts,
      source_urls = excluded.source_urls,
      raw_json = excluded.raw_json,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run({
    canonical_key: canonicalKey,
    external_id: listing.externalId ?? "",
    company_id: companyId,
    company_name: listing.company,
    title: listing.title,
    location: listing.location,
    country: listing.country,
    language: listing.language,
    work_model: listing.workModel,
    employment_type: listing.employmentType,
    salary: listing.salary,
    description: listing.description,
    url: listing.url,
    source: listing.source,
    source_type: listing.sourceType,
    lane: listing.lane,
    status: excluded ? "excluded" : "analyzed",
    category: excluded ? "Excluded" : category,
    score,
    match_rationale: rationale,
    relevant_projects: relevantProjects.join(", ") || profile.toolSignals.slice(0, 3).join(", "),
    outreach_draft: "",
    public_contacts: JSON.stringify(uniqueNonEmpty([...listing.publicContacts, ...listing.publicEmails])),
    source_urls: JSON.stringify(uniqueNonEmpty(listing.sourceUrls)),
    raw_json: JSON.stringify(listing.raw ?? {}),
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return { inserted, updated: !inserted, excluded };
}

export function recordSearchRun(
  db: Database.Database,
  lane: SearchLane,
  query: string,
  sourceType: string,
  status: string,
  foundCount: number,
  newCount: number,
  error = "",
): void {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO search_runs (
      lane, query, source_type, status, found_count, new_count, started_at, finished_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lane, query, sourceType, status, foundCount, newCount, timestamp, timestamp, error);
}

export function listTopJobs(db: Database.Database, limit: number): JobRecord[] {
  return db
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'analyzed'
       ORDER BY score DESC, last_seen_at DESC
       LIMIT ?`,
    )
    .all(limit) as JobRecord[];
}

export function listCompanies(db: Database.Database, limit: number): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT c.*, COUNT(j.id) AS open_jobs
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id AND j.status != 'excluded'
       GROUP BY c.id
       ORDER BY open_jobs DESC, c.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
}

export function getJobById(db: Database.Database, jobId: number): JobRecord | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRecord | undefined;
}

export function saveOutreachDraft(db: Database.Database, jobId: number, draft: string): void {
  db.prepare(
    "UPDATE jobs SET outreach_draft = ?, outreach_state = 'drafted', updated_at = ? WHERE id = ?",
  ).run(draft, nowIso(), jobId);
}

export function getStoredSpreadsheetId(db: Database.Database): string {
  const row = db
    .prepare("SELECT spreadsheet_id FROM sheet_sync_state WHERE scope = 'default'")
    .get() as { spreadsheet_id: string } | undefined;
  return row?.spreadsheet_id ?? "";
}

export function saveSpreadsheetState(
  db: Database.Database,
  spreadsheetId: string,
  fields: { lastSyncAt?: string; lastPullAt?: string; meta?: Record<string, unknown> },
): void {
  const existing = db
    .prepare("SELECT id, meta_json FROM sheet_sync_state WHERE scope = 'default'")
    .get() as { id: number; meta_json: string } | undefined;
  const meta = fields.meta ?? (existing ? JSON.parse(existing.meta_json || "{}") : {});

  if (existing) {
    db.prepare(`
      UPDATE sheet_sync_state
      SET spreadsheet_id = ?, last_sync_at = ?, last_pull_at = ?, meta_json = ?
      WHERE scope = 'default'
    `).run(spreadsheetId, fields.lastSyncAt ?? "", fields.lastPullAt ?? "", JSON.stringify(meta));
    return;
  }

  db.prepare(`
    INSERT INTO sheet_sync_state (scope, spreadsheet_id, last_sync_at, last_pull_at, meta_json)
    VALUES (?, ?, ?, ?, ?)
  `).run("default", spreadsheetId, fields.lastSyncAt ?? "", fields.lastPullAt ?? "", JSON.stringify(meta));
}

export function updateJobManualFields(
  db: Database.Database,
  canonicalKey: string,
  fields: Partial<
    Pick<
      JobRecord,
      "manual_status" | "owner_notes" | "priority" | "outreach_state" | "manual_contact_override"
    >
  >,
): void {
  db.prepare(`
    UPDATE jobs
    SET manual_status = COALESCE(@manual_status, manual_status),
        owner_notes = COALESCE(@owner_notes, owner_notes),
        priority = COALESCE(@priority, priority),
        outreach_state = COALESCE(@outreach_state, outreach_state),
        manual_contact_override = COALESCE(@manual_contact_override, manual_contact_override),
        updated_at = @updated_at
    WHERE canonical_key = @canonical_key
  `).run({
    canonical_key: canonicalKey,
    manual_status: fields.manual_status ?? null,
    owner_notes: fields.owner_notes ?? null,
    priority: fields.priority ?? null,
    outreach_state: fields.outreach_state ?? null,
    manual_contact_override: fields.manual_contact_override ?? null,
    updated_at: nowIso(),
  });
}

export function summarizeRun(results: Array<{ inserted: boolean; updated: boolean; excluded: boolean }>): RunSummary {
  return {
    totalFound: results.length,
    totalNew: results.filter((result) => result.inserted).length,
    totalUpdated: results.filter((result) => result.updated).length,
    excluded: results.filter((result) => result.excluded).length,
    companiesTouched: 0,
    contactsTouched: 0,
  };
}

import fs from "node:fs";
import { google } from "googleapis";
import { getStoredSpreadsheetId, openDatabase, saveSpreadsheetState, updateJobManualFields } from "./db.js";
import type { JobRecord } from "./types.js";

type Row = Record<string, string>;

export interface SheetGateway {
  createSpreadsheet(title: string, folderId?: string): Promise<string>;
  ensureSheet(spreadsheetId: string, title: string): Promise<void>;
  readSheet(spreadsheetId: string, title: string): Promise<Row[]>;
  writeSheet(spreadsheetId: string, title: string, rows: Row[]): Promise<void>;
}

const JOB_MANUAL_COLUMNS = [
  "manual_status",
  "owner_notes",
  "priority",
  "outreach_state",
  "manual_contact_override",
] as const;

function getGoogleAuth() {
  const json = process.env.SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON;
  const filePath = process.env.SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH;

  if (!json && !filePath) {
    throw new Error(
      "Missing Google service account credentials. Set SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON or SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH.",
    );
  }

  const credentials = json ? JSON.parse(json) : JSON.parse(fs.readFileSync(filePath!, "utf8"));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

export class GoogleSheetGateway implements SheetGateway {
  private readonly sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
  private readonly drive = google.drive({ version: "v3", auth: getGoogleAuth() });

  async createSpreadsheet(title: string, folderId?: string): Promise<string> {
    const spreadsheet = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error("Google Sheets create call returned no spreadsheet ID.");
    }

    if (folderId) {
      await this.drive.files.update({
        fileId: spreadsheetId,
        addParents: folderId,
      });
    }

    return spreadsheetId;
  }

  async ensureSheet(spreadsheetId: string, title: string): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
    const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === title);
    if (exists) {
      return;
    }
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  async readSheet(spreadsheetId: string, title: string): Promise<Row[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A:ZZ`,
    });
    const values = response.data.values ?? [];
    if (values.length < 2) {
      return [];
    }
    const headers = values[0];
    return values.slice(1).map((row) => {
      const record: Row = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
  }

  async writeSheet(spreadsheetId: string, title: string, rows: Row[]): Promise<void> {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const values = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];

    // Clear old content first so removed columns don't linger in the sheet.
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${title}!A:ZZ`,
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

function jobRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const jobs = db
    .prepare("SELECT * FROM jobs ORDER BY score DESC, updated_at DESC")
    .all() as JobRecord[];
  return jobs.map((job) => ({
    canonical_key: job.canonical_key,
    title: job.title,
    company_name: job.company_name,
    lane: job.lane,
    score: String(job.score),
    category: job.category,
    location: job.location,
    country: job.country,
    language: job.language,
    work_model: job.work_model,
    url: job.url,
    source: job.source,
  }));
}

function companyRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const companies = db.prepare("SELECT * FROM companies ORDER BY updated_at DESC").all() as Array<
    Record<string, unknown>
  >;
  return companies.map((company) => ({
    canonical_key: String(company.canonical_key ?? ""),
    name: String(company.name ?? ""),
    domain: String(company.domain ?? ""),
    location: String(company.location ?? ""),
    company_url: String(company.company_url ?? ""),
    careers_url: String(company.careers_url ?? ""),
    linkedin_url: String(company.linkedin_url ?? ""),
    description: String(company.description ?? ""),
    public_contacts: String(company.public_contacts ?? "[]"),
    source_urls: String(company.source_urls ?? "[]"),
    last_seen_at: String(company.last_seen_at ?? ""),
    updated_at: String(company.updated_at ?? ""),
  }));
}

function contactRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const contacts = db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all() as Array<
    Record<string, unknown>
  >;
  return contacts.map((contact) => ({
    canonical_key: String(contact.canonical_key ?? ""),
    company_id: String(contact.company_id ?? ""),
    name: String(contact.name ?? ""),
    title: String(contact.title ?? ""),
    email: String(contact.email ?? ""),
    source_url: String(contact.source_url ?? ""),
    linkedin_url: String(contact.linkedin_url ?? ""),
    kind: String(contact.kind ?? ""),
    notes: String(contact.notes ?? ""),
    last_seen_at: String(contact.last_seen_at ?? ""),
    updated_at: String(contact.updated_at ?? ""),
  }));
}

function mergeManualColumns(localRows: Row[], existingRows: Row[]): Row[] {
  const existingByKey = new Map(existingRows.map((row) => [row.canonical_key, row]));
  return localRows.map((row) => {
    const existing = existingByKey.get(row.canonical_key);
    if (!existing) {
      return row;
    }
    const merged = { ...row };
    for (const column of JOB_MANUAL_COLUMNS) {
      if (existing[column]) {
        merged[column] = existing[column];
      }
    }
    return merged;
  });
}

export async function syncSheets(baseDir: string, gateway: SheetGateway = new GoogleSheetGateway()) {
  const { db } = openDatabase(baseDir);
  const spreadsheetId =
    process.env.SNIPER_GOOGLE_SHEET_ID ||
    getStoredSpreadsheetId(db) ||
    (await gateway.createSpreadsheet("Claw Job Sniper", process.env.SNIPER_GOOGLE_FOLDER_ID));

  const tabs = [
    process.env.SNIPER_JOBS_TAB || "Jobs",
    process.env.SNIPER_COMPANIES_TAB || "Companies",
    process.env.SNIPER_CONTACTS_TAB || "Contacts",
  ];

  for (const title of tabs) {
    await gateway.ensureSheet(spreadsheetId, title);
  }

  const mergedJobs = mergeManualColumns(
    jobRows(db),
    await gateway.readSheet(spreadsheetId, process.env.SNIPER_JOBS_TAB || "Jobs"),
  );
  await gateway.writeSheet(spreadsheetId, process.env.SNIPER_JOBS_TAB || "Jobs", mergedJobs);
  await gateway.writeSheet(spreadsheetId, process.env.SNIPER_COMPANIES_TAB || "Companies", companyRows(db));
  await gateway.writeSheet(spreadsheetId, process.env.SNIPER_CONTACTS_TAB || "Contacts", contactRows(db));

  saveSpreadsheetState(db, spreadsheetId, { lastSyncAt: new Date().toISOString() });
  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    jobs: mergedJobs.length,
  };
}

export async function pullSheets(baseDir: string, gateway: SheetGateway = new GoogleSheetGateway()) {
  const { db } = openDatabase(baseDir);
  const spreadsheetId = process.env.SNIPER_GOOGLE_SHEET_ID || getStoredSpreadsheetId(db);
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID configured or stored yet. Run `sheet sync` first.");
  }

  const rows = await gateway.readSheet(spreadsheetId, process.env.SNIPER_JOBS_TAB || "Jobs");
  for (const row of rows) {
    if (!row.canonical_key) {
      continue;
    }
    updateJobManualFields(db, row.canonical_key, {
      manual_status: row.manual_status,
      owner_notes: row.owner_notes,
      priority: row.priority,
      outreach_state: row.outreach_state,
      manual_contact_override: row.manual_contact_override,
    });
  }
  saveSpreadsheetState(db, spreadsheetId, { lastPullAt: new Date().toISOString() });
  return { spreadsheetId, pulled: rows.length };
}

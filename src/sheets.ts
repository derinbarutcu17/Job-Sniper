import fs from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "./config.js";
import { getStoredSpreadsheetId, openDatabase, saveSpreadsheetState, updateJobManualFields } from "./db.js";
import type { JobRecord } from "./types.js";

type Row = Record<string, string>;

export interface SheetGateway {
  createSpreadsheet(title: string, folderId?: string): Promise<string>;
  ensureSheet(spreadsheetId: string, title: string): Promise<void>;
  readSheet(spreadsheetId: string, title: string): Promise<Row[]>;
  writeSheet(spreadsheetId: string, title: string, rows: Row[], headers?: string[]): Promise<void>;
}

const JOB_HEADERS = [
  "canonical_key",
  "title",
  "title_family",
  "company_name",
  "lane",
  "score",
  "eligibility",
  "category",
  "recommendation",
  "recommended_route",
  "route_confidence",
  "pitch_theme",
  "pitch_angle",
  "outreach_leverage_score",
  "interview_probability_band",
  "opportunity_cost_band",
  "startup_fit_score",
  "contactability_score",
  "location",
  "work_model",
  "posted_at",
  "url",
  "best_contact",
  "explanation_short",
  "manual_status",
  "priority",
  "outreach_state",
  "owner_notes",
  "manual_contact_override",
] as const;

const COMPANY_HEADERS = [
  "canonical_key",
  "name",
  "domain",
  "startup_score",
  "company_fit_score",
  "hiring_signal_score",
  "recommendation",
  "best_route",
  "pitch_theme",
  "pitch_angle",
  "open_role_count",
  "direct_contact_count",
  "reachable_now",
  "priority_band",
  "location",
  "careers_url",
  "linkedin_url",
  "best_contact",
  "notes",
] as const;

const CONTACT_HEADERS = [
  "canonical_key",
  "company_name",
  "kind",
  "name",
  "title",
  "email",
  "linkedin_url",
  "source_url",
  "confidence",
  "is_public",
  "evidence_type",
] as const;

const RUN_METRIC_HEADERS = [
  "run_timestamp",
  "total_discovered",
  "total_deduped",
  "total_parsed",
  "fetch_success_rate",
  "parse_success_rate",
  "js_fallback_rate",
  "jobs_eligible",
  "companies_discovered",
  "contacts_discovered",
  "actionable_count",
  "apply_now_count",
  "cold_email_count",
  "enrich_first_count",
  "watch_count",
  "discard_count",
  "direct_contact_companies",
  "founder_surface_companies",
  "average_outreach_leverage_score",
  "source_breakdown",
] as const;

const JOB_MANUAL_COLUMNS = [
  "manual_status",
  "owner_notes",
  "priority",
  "outreach_state",
  "manual_contact_override",
] as const;

function resolveSheetSettings(baseDir: string) {
  const config = loadConfig(baseDir);
  return {
    spreadsheetId: config.sheets.spreadsheetId || process.env.SNIPER_GOOGLE_SHEET_ID || "",
    createIfMissing: config.sheets.createIfMissing,
    folderId: config.sheets.folderId || process.env.SNIPER_GOOGLE_FOLDER_ID || "",
    tabs: {
      jobs: config.sheets.tabs.jobs || process.env.SNIPER_JOBS_TAB || "Jobs",
      companies: config.sheets.tabs.companies || process.env.SNIPER_COMPANIES_TAB || "Companies",
      contacts: config.sheets.tabs.contacts || process.env.SNIPER_CONTACTS_TAB || "Contacts",
      runMetrics: config.sheets.tabs.runMetrics || process.env.SNIPER_RUN_METRICS_TAB || "RunMetrics",
      dailyJobsPrefix: config.sheets.tabs.dailyJobsPrefix || process.env.SNIPER_DAILY_JOBS_PREFIX || "Jobs ",
    },
  };
}

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
    if (exists) return;
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
    if (!values.length) return [];
    const headers = values[0];
    if (values.length < 2) return [];
    return values.slice(1).map((row) => {
      const record: Row = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
  }

  async writeSheet(spreadsheetId: string, title: string, rows: Row[], headers: string[] = []): Promise<void> {
    const resolvedHeaders = headers.length ? headers : rows.length ? Object.keys(rows[0]) : [];
    const values = [resolvedHeaders, ...rows.map((row) => resolvedHeaders.map((header) => row[header] ?? ""))];
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

function shortExplanation(job: JobRecord): string {
  const positives = (() => {
    try {
      const parsed = JSON.parse(job.score_explanation_json || "{}") as { positives?: string[]; negatives?: string[] };
      const parts = [...(parsed.positives ?? []).slice(0, 2), ...(parsed.negatives ?? []).slice(0, 1)];
      return parts.join(" | ");
    } catch {
      return job.match_rationale;
    }
  })();
  return (positives || job.match_rationale || "").slice(0, 240);
}

function bestContact(job: JobRecord): string {
  if (job.manual_contact_override) return job.manual_contact_override;
  try {
    const contacts = JSON.parse(job.public_contacts || "[]") as Array<{ email?: string; linkedinUrl?: string; confidence?: string }>;
    const preferred = contacts.find((contact) => contact.email && contact.confidence === "high") ?? contacts.find((contact) => contact.email) ?? contacts[0];
    return preferred?.email || preferred?.linkedinUrl || "";
  } catch {
    return "";
  }
}

function jobRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status != 'excluded' ORDER BY score DESC, updated_at DESC")
    .all() as JobRecord[];
  return jobs.map((job) => ({
    canonical_key: job.canonical_key,
    title: job.title,
    title_family: job.title_family,
    company_name: job.company_name,
    lane: job.lane,
    score: String(job.score),
    eligibility: job.eligibility,
    category: job.category,
    recommendation: job.recommendation || "watch",
    recommended_route: job.recommended_route || "no_action",
    route_confidence: String(job.route_confidence ?? 0),
    pitch_theme: job.pitch_theme || "",
    pitch_angle: job.pitch_angle || "",
    outreach_leverage_score: String(job.outreach_leverage_score ?? 0),
    interview_probability_band: job.interview_probability_band || "low",
    opportunity_cost_band: job.opportunity_cost_band || "medium",
    startup_fit_score: String(job.startup_fit_score),
    contactability_score: String(job.contactability_score),
    location: job.location,
    work_model: job.work_model,
    posted_at: job.posted_at,
    url: job.url,
    best_contact: bestContact(job),
    explanation_short: shortExplanation(job),
    manual_status: job.manual_status || "",
    priority: job.priority || "",
    outreach_state: job.outreach_state || "",
    owner_notes: job.owner_notes || "",
    manual_contact_override: job.manual_contact_override || "",
  }));
}

function companyRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const companies = db
    .prepare("SELECT * FROM companies ORDER BY startup_score DESC, company_fit_score DESC, updated_at DESC")
    .all() as Array<Record<string, unknown>>;

  return companies.map((company) => ({
    canonical_key: String(company.canonical_key ?? ""),
    name: String(company.name ?? ""),
    domain: String(company.domain ?? ""),
    startup_score: String(company.startup_score ?? 0),
    company_fit_score: String(company.company_fit_score ?? 0),
    hiring_signal_score: String(company.hiring_signal_score ?? 0),
    recommendation: String(company.recommendation ?? "watch"),
    best_route: String(company.best_route ?? "watch_company"),
    pitch_theme: String(company.pitch_theme ?? ""),
    pitch_angle: String(company.pitch_angle ?? ""),
    open_role_count: String(company.open_role_count ?? 0),
    direct_contact_count: String(company.direct_contact_count ?? 0),
    reachable_now: String(company.reachable_now ?? 0),
    priority_band: String(company.priority_band ?? "low"),
    location: String(company.location ?? ""),
    careers_url: String(company.careers_url ?? ""),
    linkedin_url: String(company.linkedin_url ?? ""),
    best_contact: (() => {
      try {
        const contacts = JSON.parse(String(company.public_contacts ?? "[]")) as string[];
        return contacts[0] ?? "";
      } catch {
        return "";
      }
    })(),
    notes: String(company.stage_text ?? ""),
  }));
}

function contactRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const contacts = db
    .prepare(`
      SELECT ct.*, c.name AS company_name
      FROM contacts ct
      LEFT JOIN companies c ON c.id = ct.company_id
      ORDER BY
        CASE ct.confidence WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC,
        ct.updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  return contacts.map((contact) => ({
    canonical_key: String(contact.canonical_key ?? ""),
    company_name: String(contact.company_name ?? ""),
    kind: String(contact.contact_kind ?? ""),
    name: String(contact.name ?? ""),
    title: String(contact.title ?? ""),
    email: String(contact.email ?? ""),
    linkedin_url: String(contact.linkedin_url ?? ""),
    source_url: String(contact.source_url ?? ""),
    confidence: String(contact.confidence ?? ""),
    is_public: String(contact.is_public ?? 1),
    evidence_type: String(contact.evidence_type ?? ""),
  }));
}

function runMetricRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const metrics = db
    .prepare(`
      SELECT *
      FROM run_metrics
      ORDER BY id DESC
      LIMIT 50
    `)
    .all() as Array<Record<string, unknown>>;

  return metrics.map((row) => ({
    run_timestamp: String(row.finished_at || row.started_at || ""),
    total_discovered: String(row.total_discovered ?? 0),
    total_deduped: String(row.total_deduped ?? 0),
    total_parsed: String(row.total_parsed ?? 0),
    fetch_success_rate: String(row.fetch_success_rate ?? 0),
    parse_success_rate: String(row.parse_success_rate ?? 0),
    js_fallback_rate: String(row.js_fallback_rate ?? 0),
    jobs_eligible: String(row.jobs_eligible ?? 0),
    companies_discovered: String(row.companies_discovered ?? 0),
    contacts_discovered: String(row.contacts_discovered ?? 0),
    actionable_count: String(row.actionable_count ?? 0),
    apply_now_count: String(row.apply_now_count ?? 0),
    cold_email_count: String(row.cold_email_count ?? 0),
    enrich_first_count: String(row.enrich_first_count ?? 0),
    watch_count: String(row.watch_count ?? 0),
    discard_count: String(row.discard_count ?? 0),
    direct_contact_companies: String(row.direct_contact_companies ?? 0),
    founder_surface_companies: String(row.founder_surface_companies ?? 0),
    average_outreach_leverage_score: String(row.average_outreach_leverage_score ?? 0),
    source_breakdown: String(row.source_breakdown_json ?? "{}"),
  }));
}

function mergeManualColumns(localRows: Row[], existingRows: Row[]): Row[] {
  const existingByKey = new Map(existingRows.map((row) => [row.canonical_key, row]));
  return localRows.map((row) => {
    const existing = existingByKey.get(row.canonical_key);
    if (!existing) return row;
    const merged = { ...row };
    for (const column of JOB_MANUAL_COLUMNS) {
      merged[column] = existing[column] ?? row[column] ?? "";
    }
    return merged;
  });
}

function dayKey(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "unknown-date";
}

function dailyJobTabs(
  db: ReturnType<typeof openDatabase>["db"],
  prefix = "Jobs ",
): Array<{ title: string; rows: Row[] }> {
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status != 'excluded' ORDER BY created_at DESC, updated_at DESC")
    .all() as JobRecord[];

  const groups = new Map<string, JobRecord[]>();
  for (const job of jobs) {
    const key = dayKey(job.posted_at || job.created_at || job.updated_at || "");
    const rows = groups.get(key) ?? [];
    rows.push(job);
    groups.set(key, rows);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => ({
      title: `${prefix}${date}`.slice(0, 100),
      rows: rows.map((job) => ({
        canonical_key: job.canonical_key,
        title: job.title,
        title_family: job.title_family,
        company_name: job.company_name,
        lane: job.lane,
        score: String(job.score),
        eligibility: job.eligibility,
        category: job.category,
        recommendation: job.recommendation || "watch",
        recommended_route: job.recommended_route || "no_action",
        route_confidence: String(job.route_confidence ?? 0),
        pitch_theme: job.pitch_theme || "",
        pitch_angle: job.pitch_angle || "",
        outreach_leverage_score: String(job.outreach_leverage_score ?? 0),
        interview_probability_band: job.interview_probability_band || "low",
        opportunity_cost_band: job.opportunity_cost_band || "medium",
        startup_fit_score: String(job.startup_fit_score),
        contactability_score: String(job.contactability_score),
        location: job.location,
        work_model: job.work_model,
        posted_at: job.posted_at,
        url: job.url,
        best_contact: bestContact(job),
        explanation_short: shortExplanation(job),
        manual_status: job.manual_status || "",
        priority: job.priority || "",
        outreach_state: job.outreach_state || "",
        owner_notes: job.owner_notes || "",
        manual_contact_override: job.manual_contact_override || "",
      })),
    }));
}

export async function syncSheets(baseDir: string, gateway: SheetGateway = new GoogleSheetGateway()) {
  const { db } = openDatabase(baseDir);
  const settings = resolveSheetSettings(baseDir);
  const spreadsheetId =
    settings.spreadsheetId ||
    getStoredSpreadsheetId(db) ||
    (settings.createIfMissing ? await gateway.createSpreadsheet("Claw Job Sniper", settings.folderId) : "");

  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID configured and sheet auto-create is disabled.");
  }

  for (const title of Object.values(settings.tabs)) {
    await gateway.ensureSheet(spreadsheetId, title);
  }

  const existingJobs = await gateway.readSheet(spreadsheetId, settings.tabs.jobs);
  const mergedJobs = mergeManualColumns(jobRows(db), existingJobs);

  await gateway.writeSheet(spreadsheetId, settings.tabs.jobs, mergedJobs, [...JOB_HEADERS]);
  await gateway.writeSheet(spreadsheetId, settings.tabs.companies, companyRows(db), [...COMPANY_HEADERS]);
  await gateway.writeSheet(spreadsheetId, settings.tabs.contacts, contactRows(db), [...CONTACT_HEADERS]);
  await gateway.writeSheet(spreadsheetId, settings.tabs.runMetrics, runMetricRows(db), [...RUN_METRIC_HEADERS]);

  for (const tab of dailyJobTabs(db, settings.tabs.dailyJobsPrefix ?? "Jobs ")) {
    await gateway.ensureSheet(spreadsheetId, tab.title);
    await gateway.writeSheet(spreadsheetId, tab.title, tab.rows, [...JOB_HEADERS]);
  }

  saveSpreadsheetState(db, spreadsheetId, { lastSyncAt: new Date().toISOString() });
  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    jobs: mergedJobs.length,
  };
}

export async function pullSheets(baseDir: string, gateway: SheetGateway = new GoogleSheetGateway()) {
  const { db } = openDatabase(baseDir);
  const settings = resolveSheetSettings(baseDir);
  const spreadsheetId = settings.spreadsheetId || getStoredSpreadsheetId(db);
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID configured or stored yet. Run `sheet sync` first.");
  }

  const rows = await gateway.readSheet(spreadsheetId, settings.tabs.jobs);
  let pulled = 0;
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
    pulled += 1;
  }

  saveSpreadsheetState(db, spreadsheetId, { lastPullAt: new Date().toISOString() });
  return { spreadsheetId, pulled };
}

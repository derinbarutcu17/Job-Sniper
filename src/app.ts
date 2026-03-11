import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import {
  enqueueDiscoveryCandidates,
  getJobById,
  listCompanies,
  listContacts,
  listTopJobs,
  openDatabase,
  upsertCompany,
  upsertContact,
} from "./db.js";
import { draftOutreach } from "./draft.js";
import { createDefaultDependencies } from "./lib/http.js";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl, normalizeUrl } from "./lib/url.js";
import { onboardProfile } from "./profile.js";
import { runDiscovery } from "./search/discovery.js";
import { buildPageRecord, extractContacts } from "./search/extract.js";
import { getSearchProviders } from "./search/web.js";
import { pullSheets, syncSheets, type SheetGateway } from "./sheets.js";
import type { Dependencies, SearchLane } from "./types.js";

export interface AppDependencies {
  deps?: Dependencies;
  sheetGateway?: SheetGateway;
}

function parseCompanyRef(input: string): { id?: number; key?: string } {
  const maybeId = Number(input);
  if (Number.isFinite(maybeId)) {
    return { id: maybeId };
  }
  return { key: input.trim() };
}

async function enrichCompanyRecord(baseDir: string, deps: Dependencies, companyRef: string): Promise<string> {
  const { db } = openDatabase(baseDir);
  const ref = parseCompanyRef(companyRef);
  const company = ref.id
    ? (db.prepare("SELECT * FROM companies WHERE id = ?").get(ref.id) as Record<string, unknown> | undefined)
    : (db.prepare("SELECT * FROM companies WHERE canonical_key = ? OR lower(name) = lower(?)").get(ref.key, ref.key) as
        | Record<string, unknown>
        | undefined);
  if (!company) {
    throw new Error(`Company not found: ${companyRef}`);
  }

  const baseUrl =
    String(company.company_url ?? "") ||
    (String(company.domain ?? "") ? `https://${String(company.domain)}` : "");
  if (!baseUrl) {
    throw new Error(`Company ${String(company.name ?? companyRef)} has no known domain.`);
  }

  const allowlist = [
    baseUrl,
    new URL("/about", baseUrl).toString(),
    new URL("/team", baseUrl).toString(),
    new URL("/careers", baseUrl).toString(),
    new URL("/jobs", baseUrl).toString(),
    new URL("/contact", baseUrl).toString(),
    new URL("/imprint", baseUrl).toString(),
    new URL("/press", baseUrl).toString(),
  ];

  let touchedContacts = 0;
  let touchedPages = 0;
  const companyKey = String(company.canonical_key);
  const publicContacts = new Set<string>();

  for (const url of allowlist) {
    try {
      const response = await deps.fetch(url);
      if (!response.ok) continue;
      const html = await response.text();
      const page = buildPageRecord(url, html, "manual_enrich", "page");
      const contacts = extractContacts(page);
      touchedPages += 1;
      for (const contact of contacts) {
        publicContacts.add(contact.email || contact.linkedinUrl || contact.sourceUrl);
        upsertContact(db, {
          canonicalKey: canonicalContactKey(contact.email, contact.linkedinUrl, contact.name || url, companyKey),
          companyCanonicalKey: companyKey,
          name: contact.name,
          title: contact.title,
          email: contact.email,
          sourceUrl: contact.sourceUrl,
          linkedinUrl: contact.linkedinUrl,
          contactKind: contact.kind,
          notes: contact.kind,
          confidence: contact.confidence,
          evidenceType: contact.evidenceType,
          evidenceExcerpt: contact.evidenceExcerpt,
          isPublic: contact.isPublic,
          lastVerifiedAt: new Date().toISOString(),
          pageType: contact.pageType,
          lastSeenAt: new Date().toISOString(),
        });
        touchedContacts += 1;
      }
      upsertCompany(db, {
        canonicalKey: companyKey,
        name: String(company.name ?? ""),
        domain: String(company.domain ?? domainFromUrl(baseUrl)),
        location: /istanbul/i.test(page.text)
          ? "Istanbul"
          : String(company.location ?? ""),
        companyUrl: baseUrl,
        careersUrl: /careers|jobs/i.test(url) ? url : String(company.careers_url ?? ""),
        aboutUrl: /about/i.test(url) ? url : String(company.about_url ?? ""),
        teamUrl: /team/i.test(url) ? url : String(company.team_url ?? ""),
        contactUrl: /contact|imprint/i.test(url) ? url : String(company.contact_url ?? ""),
        pressUrl: /press/i.test(url) ? url : String(company.press_url ?? ""),
        linkedinUrl:
          contacts.find((contact) => contact.kind === "linkedin_company")?.linkedinUrl ||
          String(company.linkedin_url ?? ""),
        description: page.text.slice(0, 1200),
        sourceUrls: [baseUrl, ...allowlist],
        publicContacts: [...publicContacts],
        startupSignals: /seed|series a|founding|small team/i.test(page.text) ? ["startup_language"] : [],
        hiringSignals: /hiring|careers|open roles|jobs/i.test(page.text) ? ["hiring_language"] : [],
        founderNames: [],
        cities: /istanbul/i.test(page.text) ? ["Istanbul"] : [],
        sizeBand: String(company.size_band ?? ""),
        stageText: /seed|series a|founding/i.test(page.text) ? "startup signal" : String(company.stage_text ?? ""),
        remotePolicy: /remote|uzaktan|hybrid/i.test(page.text) ? "remote-friendly" : String(company.remote_policy ?? ""),
        openRoleCount: Number(company.open_role_count ?? 0),
        startupScore: /seed|series a|founding|small team/i.test(page.text) ? 12 : Number(company.startup_score ?? 0),
        companyFitScore: Number(company.company_fit_score ?? 0),
        hiringSignalScore: /hiring|careers|jobs/i.test(page.text) ? 8 : Number(company.hiring_signal_score ?? 0),
        contactabilityScore: publicContacts.size ? 10 : Number(company.contactability_score ?? 0),
        isStartupCandidate:
          /seed|series a|founding|small team/i.test(page.text) || Boolean(Number(company.is_startup_candidate ?? 0)),
        lastSeenAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort enrichment.
    }
  }

  return `Enriched ${String(company.name ?? companyRef)}. Pages checked: ${touchedPages}, contacts refreshed: ${touchedContacts}.`;
}

export function createApp(baseDir: string, dependencies: AppDependencies = {}) {
  const deps = dependencies.deps ?? createDefaultDependencies();
  const sheetGateway = dependencies.sheetGateway;

  return {
    async onboard(input: string) {
      const content = input || (process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8"));
      const result = await onboardProfile(baseDir, content);
      return `Profile synced.\nRole families: ${result.profile.roleFamilies.join(", ")}\nTarget seniority: ${result.profile.targetSeniority}\nSignals: ${result.profile.toolSignals.join(", ")}`;
    },

    async run(options: { lane?: SearchLane; companyWatchOnly?: boolean } = {}) {
      const summary = await runDiscovery(baseDir, deps, options);
      return `Scout complete. Found ${summary.totalFound}, new ${summary.totalNew}, refreshed ${summary.totalUpdated}, excluded ${summary.excluded}, deduped ${summary.deduped}, parsed ${summary.parsed}.`;
    },

    digest(limit = 5) {
      const { db } = openDatabase(baseDir);
      const jobs = listTopJobs(db, limit);
      if (!jobs.length) {
        return "No ranked jobs yet. Run `run` first.";
      }
      return jobs
        .map(
          (job, index) =>
            `${index + 1}. [${job.id}] ${job.title} @ ${job.company_name} | ${job.category} | ${Math.round(job.score)} | ${job.location || "Unknown"} | ${job.eligibility}`,
        )
        .join("\n");
    },

    shortlist(limit = 10) {
      const { db } = openDatabase(baseDir);
      const jobs = db
        .prepare("SELECT * FROM jobs WHERE eligibility = 'eligible' AND status != 'excluded' ORDER BY score DESC, updated_at DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>;
      if (!jobs.length) {
        return "No eligible shortlist yet.";
      }
      return jobs
        .map(
          (job, index) =>
            `${index + 1}. [${String(job.id)}] ${String(job.title)} @ ${String(job.company_name)} | ${Math.round(Number(job.score ?? 0))} | ${String(job.location ?? "")}`,
        )
        .join("\n");
    },

    draft(jobId: number) {
      return draftOutreach(baseDir, jobId);
    },

    explain(jobId: number) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      if (!job) {
        throw new Error(`Job ${jobId} was not found.`);
      }
      const explanation = JSON.parse(job.score_explanation_json || "{}") as {
        positives?: string[];
        negatives?: string[];
        gatesPassed?: string[];
        gatesFailed?: string[];
      };
      return [
        `[${job.id}] ${job.title} @ ${job.company_name}`,
        `Score: ${Math.round(job.score)} | ${job.category} | ${job.eligibility}`,
        `Title family: ${job.title_family || "Unknown"}`,
        `Positives: ${(explanation.positives ?? []).join("; ") || "None"}`,
        `Negatives: ${(explanation.negatives ?? []).join("; ") || "None"}`,
        `Gates passed: ${(explanation.gatesPassed ?? []).join(", ") || "None"}`,
        `Gates failed: ${(explanation.gatesFailed ?? []).join(", ") || "None"}`,
      ].join("\n");
    },

    blacklistAdd(input: { term: string; mode: "company" | "keyword"; lane?: SearchLane }) {
      const config = loadConfig(baseDir);
      const term = input.term.trim();
      if (!term) {
        throw new Error("blacklist add requires a term.");
      }
      if (input.mode === "company") {
        if (!config.blacklist.companies.includes(term)) {
          config.blacklist.companies.push(term);
        }
      } else if (input.lane) {
        if (!config.blacklist.lanes[input.lane].includes(term)) {
          config.blacklist.lanes[input.lane].push(term);
        }
      } else if (!config.blacklist.keywords.includes(term)) {
        config.blacklist.keywords.push(term);
      }
      saveConfig(baseDir, config);
      return `Blacklisted ${input.mode}: ${term}${input.lane ? ` (${input.lane})` : ""}`;
    },

    companies(limit = 10) {
      const { db } = openDatabase(baseDir);
      const companies = listCompanies(db, limit);
      if (!companies.length) {
        return "No companies tracked yet. Run `run` first.";
      }
      return companies
        .map(
          (company, index) =>
            `${index + 1}. ${String(company.name ?? "")} | startup ${Math.round(Number(company.startup_score ?? 0))} | fit ${Math.round(Number(company.company_fit_score ?? 0))} | ${String(company.location ?? "Unknown")} | ${String(company.careers_url ?? company.company_url ?? "")}`,
        )
        .join("\n");
    },

    contacts(companyRef?: string) {
      const { db } = openDatabase(baseDir);
      const rows = listContacts(db, companyRef);
      if (!rows.length) {
        return "No contacts tracked yet.";
      }
      return rows
        .slice(0, 20)
        .map(
          (contact, index) =>
            `${index + 1}. ${String(contact.company_name ?? "")} | ${String(contact.contact_kind ?? "")} | ${String(contact.email ?? contact.linkedin_url ?? "")} | ${String(contact.confidence ?? "")}`,
        )
        .join("\n");
    },

    async enrichCompany(companyRef: string) {
      return enrichCompanyRecord(baseDir, deps, companyRef);
    },

    requeue(url: string, lane: SearchLane = "company_watch") {
      const { db } = openDatabase(baseDir);
      const normalizedUrl = normalizeUrl(url);
      enqueueDiscoveryCandidates(db, [
        {
          url,
          normalizedUrl,
          sourceType: "page",
          lane,
          intent: "unknown",
          query: "",
          confidence: 0.5,
          source: "manual",
          discoveredAt: new Date().toISOString(),
          domain: domainFromUrl(url),
          title: "",
          snippet: "",
        },
      ]);
      return `Queued ${url} for ${lane}.`;
    },

    sourcesTest() {
      const config = loadConfig(baseDir);
      const providers = getSearchProviders();
      return [
        `Search providers: ${providers.map((provider) => provider.name).join(", ") || "none"}`,
        `ATS boards configured: ${config.sources.atsBoards.length}`,
        `RSS feeds configured: ${config.sources.rss.length}`,
        `Browser fallback: ${config.search.browserFallback ? "enabled" : "disabled"}`,
      ].join("\n");
    },

    stats() {
      const { db } = openDatabase(baseDir);
      const counts = db
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM jobs) AS jobs,
            (SELECT COUNT(*) FROM jobs WHERE eligibility = 'eligible' AND status != 'excluded') AS eligible_jobs,
            (SELECT COUNT(*) FROM companies) AS companies,
            (SELECT COUNT(*) FROM contacts) AS contacts
        `)
        .get() as { jobs: number; eligible_jobs: number; companies: number; contacts: number };
      const latestRun = db
        .prepare("SELECT * FROM run_metrics ORDER BY id DESC LIMIT 1")
        .get() as Record<string, unknown> | undefined;
      return [
        `Jobs: ${counts.jobs} total, ${counts.eligible_jobs} eligible`,
        `Companies: ${counts.companies}`,
        `Contacts: ${counts.contacts}`,
        latestRun
          ? `Last run: discovered ${String(latestRun.total_discovered ?? 0)}, deduped ${String(latestRun.total_deduped ?? 0)}, parsed ${String(latestRun.total_parsed ?? 0)}`
          : "Last run: none",
      ].join("\n");
    },

    exportJson(outputPath?: string) {
      const { db } = openDatabase(baseDir);
      const payload = {
        jobs: db.prepare("SELECT * FROM jobs ORDER BY score DESC, updated_at DESC").all(),
        companies: db.prepare("SELECT * FROM companies ORDER BY startup_score DESC, updated_at DESC").all(),
        contacts: db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all(),
        runMetrics: db.prepare("SELECT * FROM run_metrics ORDER BY id DESC LIMIT 25").all(),
      };
      const resolvedPath = outputPath || path.join(baseDir, "data", "sniper-export.json");
      fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
      return `Exported JSON to ${resolvedPath}`;
    },

    async sheetSync() {
      const result = await syncSheets(baseDir, sheetGateway);
      return `Sheets sync complete. ${result.jobs} job rows synced.\n${result.url}`;
    },

    async sheetPull() {
      const result = await pullSheets(baseDir, sheetGateway);
      return `Pulled ${result.pulled} rows from spreadsheet ${result.spreadsheetId}.`;
    },

    job(jobId: number) {
      const { db } = openDatabase(baseDir);
      return getJobById(db, jobId);
    },
  };
}

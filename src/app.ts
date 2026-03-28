import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import { renderCompanyDossier } from "./company-dossier.js";
import { logContactAttempt, logOutcome } from "./contact-log.js";
import {
  enqueueDiscoveryCandidates,
  getCompanyByRef,
  getContactsForCompanyId,
  getJobById,
  getJobsForCompany,
  listCompanies,
  listContacts,
  listTopJobs,
  openDatabase,
  upsertCompany,
  upsertContact,
} from "./db.js";
import { draftOutreach } from "./draft.js";
import { summarizeExperiments } from "./experiments.js";
import { createDefaultDependencies } from "./lib/http.js";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl, normalizeUrl } from "./lib/url.js";
import { onboardProfile } from "./profile.js";
import { getDefaultCompanyWatchLane } from "./role-packs.js";
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
        location: /berlin/i.test(page.text)
          ? "Berlin"
          : /germany|deutschland/i.test(page.text)
            ? "Germany"
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
        cities: /berlin/i.test(page.text) ? ["Berlin"] : [],
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
            `${index + 1}. [${String(job.id)}] ${String(job.title)} @ ${String(job.company_name)} | ${Math.round(Number(job.score ?? 0))} | ${String(job.recommendation ?? "watch")} | ${String(job.recommended_route ?? "no_action")} | ${String(job.location ?? "")}`,
        )
        .join("\n");
    },

    triage(limit = 10) {
      const { db } = openDatabase(baseDir);
      const jobs = db.prepare(`
        SELECT *
        FROM jobs
        WHERE status != 'excluded'
        ORDER BY
          CASE recommendation
            WHEN 'apply_now' THEN 1
            WHEN 'cold_email' THEN 2
            WHEN 'enrich_first' THEN 3
            WHEN 'watch' THEN 4
            ELSE 5
          END ASC,
          outreach_leverage_score DESC,
          score DESC,
          updated_at DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;
      if (!jobs.length) return "No triaged opportunities yet.";
      return jobs
        .map(
          (job, index) =>
            `${index + 1}. [${String(job.id)}] ${String(job.title)} @ ${String(job.company_name)} | ${String(job.recommendation)} | route ${String(job.recommended_route)} | leverage ${Math.round(Number(job.outreach_leverage_score ?? 0))}`,
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
        `Recommendation: ${job.recommendation || "watch"} | Route: ${job.recommended_route || "no_action"} (${Math.round(Number(job.route_confidence ?? 0) * 100)}%)`,
        `Title family: ${job.title_family || "Unknown"}`,
        `Pitch: ${job.pitch_theme || "generalist"} | ${job.pitch_angle || "None"}`,
        `Positives: ${(explanation.positives ?? []).join("; ") || "None"}`,
        `Negatives: ${(explanation.negatives ?? []).join("; ") || "None"}`,
        `Gates passed: ${(explanation.gatesPassed ?? []).join(", ") || "None"}`,
        `Gates failed: ${(explanation.gatesFailed ?? []).join(", ") || "None"}`,
      ].join("\n");
    },

    route(jobId: number) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      if (!job) throw new Error(`Job ${jobId} was not found.`);
      return [
        `[${job.id}] ${job.title} @ ${job.company_name}`,
        `Recommended route: ${job.recommended_route || "no_action"}`,
        `Confidence: ${Math.round(Number(job.route_confidence ?? 0) * 100)}%`,
        `Rationale: ${job.route_rationale || "No route rationale stored."}`,
      ].join("\n");
    },

    pitch(jobId: number) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      if (!job) throw new Error(`Job ${jobId} was not found.`);
      return [
        `[${job.id}] ${job.title} @ ${job.company_name}`,
        `Theme: ${job.pitch_theme || "generalist"}`,
        `Angle: ${job.pitch_angle || "No pitch angle stored."}`,
        `Strongest profile signal: ${job.strongest_profile_signal || "Unknown"}`,
        `Strongest company signal: ${job.strongest_company_signal || "Unknown"}`,
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
        config.blacklist.lanes[input.lane] ??= [];
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
            `${index + 1}. ${String(company.name ?? "")} | ${String(company.recommendation ?? "watch")} | route ${String(company.best_route ?? "watch_company")} | startup ${Math.round(Number(company.startup_score ?? 0))} | fit ${Math.round(Number(company.company_fit_score ?? 0))} | ${String(company.location ?? "Unknown")} | ${String(company.careers_url ?? company.company_url ?? "")}`,
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

    contacted() {
      const contactedPath = path.join(baseDir, "data", "contacted-companies.json");
      if (!fs.existsSync(contactedPath)) {
        return "No contacted companies log yet.";
      }
      const rows = JSON.parse(fs.readFileSync(contactedPath, "utf8")) as Array<Record<string, unknown>>;
      if (!rows.length) return "No contacted companies log yet.";
      return rows
        .slice(0, 50)
        .map((row, index) => `${index + 1}. ${String(row.company ?? "")} | ${String(row.date_contacted ?? "")} | ${String(row.channel ?? "")}`)
        .join("\n");
    },

    async enrichCompany(companyRef: string) {
      return enrichCompanyRecord(baseDir, deps, companyRef);
    },

    dossier(companyRef: string) {
      const { db } = openDatabase(baseDir);
      const company = getCompanyByRef(db, companyRef);
      if (!company) throw new Error(`Company not found: ${companyRef}`);
      const jobs = getJobsForCompany(db, Number(company.id));
      const contacts = getContactsForCompanyId(db, Number(company.id));
      return renderCompanyDossier(company, jobs, contacts);
    },

    contactLog(input: { companyRef: string; channel: "email" | "linkedin" | "ats" | "founder"; note?: string; jobId?: number }) {
      const { db } = openDatabase(baseDir);
      const entry = logContactAttempt(db, input.companyRef, input.channel, input.note ?? "", input.jobId);
      return `Logged contact attempt for ${input.companyRef} via ${entry.channel}.`;
    },

    outcomeLog(input: { companyRef: string; result: "no_reply" | "reply" | "call" | "interview" | "rejected" | "positive_signal"; note?: string; jobId?: number }) {
      const { db } = openDatabase(baseDir);
      const entry = logOutcome(db, input.companyRef, input.result, input.note ?? "", input.jobId);
      return `Logged outcome for ${input.companyRef}: ${entry.result}.`;
    },

    experiments() {
      const { db } = openDatabase(baseDir);
      const summary = summarizeExperiments(db);
      const routeLines = Object.entries(summary.replyRateByRoute).map(
        ([route, rate]) => `${route}: reply ${Math.round(rate * 100)}%, positive ${Math.round((summary.positiveOutcomeRateByRoute[route] ?? 0) * 100)}%`,
      );
      const themeLines = summary.topPitchThemes.map((theme) => `${theme.pitchTheme}: ${theme.count}`);
      return [
        "Route performance:",
        routeLines.join("\n") || "No logged outcomes yet.",
        "",
        "Top pitch themes:",
        themeLines.join("\n") || "No pitch data yet.",
      ].join("\n");
    },

    requeue(url: string, lane?: SearchLane) {
      const config = loadConfig(baseDir);
      const { db } = openDatabase(baseDir);
      const normalizedUrl = normalizeUrl(url);
      const targetLane = lane ?? getDefaultCompanyWatchLane(config);
      enqueueDiscoveryCandidates(db, [
        {
          url,
          normalizedUrl,
          sourceType: "page",
          lane: targetLane,
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
      return `Queued ${url} for ${targetLane}.`;
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
        ...(() => {
          const strategic = db.prepare(`
            SELECT
              SUM(CASE WHEN recommendation IN ('apply_now','cold_email','enrich_first') THEN 1 ELSE 0 END) AS actionable,
              SUM(CASE WHEN recommendation = 'apply_now' THEN 1 ELSE 0 END) AS apply_now,
              SUM(CASE WHEN recommendation = 'cold_email' THEN 1 ELSE 0 END) AS cold_email,
              SUM(CASE WHEN recommendation = 'enrich_first' THEN 1 ELSE 0 END) AS enrich_first,
              SUM(CASE WHEN recommendation = 'watch' THEN 1 ELSE 0 END) AS watch_count,
              SUM(CASE WHEN recommendation = 'discard' THEN 1 ELSE 0 END) AS discard_count,
              AVG(outreach_leverage_score) AS avg_leverage
            FROM jobs
          `).get() as Record<string, unknown>;
          return [
            `Strategic: ${String(strategic.actionable ?? 0)} actionable | apply ${String(strategic.apply_now ?? 0)} | cold email ${String(strategic.cold_email ?? 0)} | enrich ${String(strategic.enrich_first ?? 0)} | watch ${String(strategic.watch_count ?? 0)} | discard ${String(strategic.discard_count ?? 0)}`,
            `Average outreach leverage: ${Math.round(Number(strategic.avg_leverage ?? 0))}`,
          ];
        })(),
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
        contactLog: db.prepare("SELECT * FROM contact_log ORDER BY created_at DESC LIMIT 100").all(),
        outcomeLog: db.prepare("SELECT * FROM outcome_log ORDER BY created_at DESC LIMIT 100").all(),
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

import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import { logContactAttempt, logOutcome } from "./contact-log.js";
import {
  enqueueDiscoveryCandidates,
  listCompanies,
  listContacts,
  openDatabase,
  upsertCompany,
  upsertContact,
} from "./db.js";
import { draftOutreach } from "./draft.js";
import { summarizeExperiments } from "./experiments.js";
import { SniperError } from "./errors.js";
import { createDefaultDependencies } from "./lib/http.js";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl, normalizeUrl } from "./lib/url.js";
import { getDefaultCompanyWatchLane } from "./role-packs.js";
import { buildPageRecord, extractContacts } from "./search/extract.js";
import { getSearchProviders } from "./search/web.js";
import { pullSheets, syncSheets, type SheetGateway } from "./sheets.js";
import type { Dependencies, SearchLane } from "./types.js";
import { presentCompanies, presentContacts, presentDossier, presentJobDetail, presentJobList, presentRunResult, presentStats, presentTriage } from "./presenters.js";
import { createCompaniesService } from "./services/companies-service.js";
import { createContactsService } from "./services/contacts-service.js";
import { createJobsService } from "./services/jobs-service.js";
import { createProfileService } from "./services/profile-service.js";
import { createRunService } from "./services/run-service.js";
import { createSheetSyncService } from "./services/sheet-sync-service.js";
import { createStatsService } from "./services/stats-service.js";

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
  const profileService = createProfileService(baseDir);
  const runService = createRunService(baseDir, deps);
  const jobsService = createJobsService(baseDir);
  const companiesService = createCompaniesService(baseDir);
  const contactsService = createContactsService(baseDir);
  const sheetSyncService = createSheetSyncService(baseDir, sheetGateway);
  const statsService = createStatsService(baseDir);

  return {
    async onboard(input: string) {
      const content = input || (process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8"));
      const result = await profileService.onboard({ input: content });
      return `Profile synced.\nRole families: ${result.profile.roleFamilies.join(", ")}\nTarget seniority: ${result.profile.targetSeniority}\nSignals: ${result.profile.toolSignals.join(", ")}`;
    },

    async run(options: { lane?: SearchLane; companyWatchOnly?: boolean } = {}) {
      const result = await runService.run(options);
      return presentRunResult(result);
    },

    digest(limit = 5) {
      return presentJobList(jobsService.digest({ limit }), "digest");
    },

    shortlist(limit = 10) {
      return presentJobList(jobsService.shortlist({ limit }), "shortlist");
    },

    triage(limit = 10) {
      return presentTriage(jobsService.triage({ limit }));
    },

    draft(jobId: number) {
      return draftOutreach(baseDir, jobId);
    },

    explain(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "explain");
    },

    route(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "route");
    },

    pitch(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "pitch");
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
      return presentCompanies(companiesService.list({ limit }));
    },

    contacts(companyRef?: string) {
      return presentContacts(contactsService.list({ companyRef }));
    },

    async enrichCompany(companyRef: string) {
      return enrichCompanyRecord(baseDir, deps, companyRef);
    },

    dossier(companyRef: string) {
      const dossier = companiesService.dossier(companyRef);
      if (!dossier) throw new SniperError(`Company not found: ${companyRef}`, "not_found");
      return presentDossier(dossier);
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
      return presentStats(statsService.get());
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
      const result = await sheetSyncService.sync(statsService.get().latestRun?.id ?? null);
      return `Sheets sync complete. ${result.jobs} job rows synced.\n${result.url}`;
    },

    async sheetPull() {
      const result = await sheetSyncService.pull();
      return `Pulled ${result.pulled} rows from spreadsheet ${result.spreadsheetId}.`;
    },
  };
}

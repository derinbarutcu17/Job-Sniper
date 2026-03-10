import fs from "node:fs";
import { loadConfig, saveConfig } from "./config.js";
import { getJobById, listCompanies, listTopJobs, openDatabase } from "./db.js";
import { draftOutreach } from "./draft.js";
import { createDefaultDependencies } from "./lib/http.js";
import { onboardProfile } from "./profile.js";
import { runDiscovery } from "./search/discovery.js";
import { pullSheets, syncSheets, type SheetGateway } from "./sheets.js";

export interface AppDependencies {
  deps?: Parameters<typeof runDiscovery>[1];
  sheetGateway?: SheetGateway;
}

export function createApp(baseDir: string, dependencies: AppDependencies = {}) {
  const deps = dependencies.deps ?? createDefaultDependencies();
  const sheetGateway = dependencies.sheetGateway;

  return {
    async onboard(input: string) {
      const content = input || (process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8"));
      const result = await onboardProfile(baseDir, content);
      return `Profile synced.\nRole families: ${result.profile.roleFamilies.join(", ")}\nSignals: ${result.profile.toolSignals.join(", ")}`;
    },

    async run() {
      const summary = await runDiscovery(baseDir, deps);
      return `Scout complete. Found ${summary.totalFound} listings, ${summary.totalNew} new, ${summary.totalUpdated} refreshed, ${summary.excluded} excluded.`;
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
            `${index + 1}. [${job.id}] ${job.title} @ ${job.company_name} | ${job.category} | ${Math.round(job.score)} | ${job.location || "Unknown"}`,
        )
        .join("\n");
    },

    draft(jobId: number) {
      return draftOutreach(baseDir, jobId);
    },

    blacklistAdd(term: string) {
      const config = loadConfig(baseDir);
      if (!config.blacklist.companies.includes(term)) {
        config.blacklist.companies.push(term);
        saveConfig(baseDir, config);
      }
      return `Blacklisted: ${term}`;
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
            `${index + 1}. ${company.name} | jobs: ${company.open_jobs ?? 0} | ${company.location || "Unknown"} | ${company.careers_url || company.company_url || ""}`,
        )
        .join("\n");
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

import { loadConfig } from "../config.js";
import { openDatabase, recordSearchRun, summarizeRun, upsertJob } from "../db.js";
import { createDefaultDependencies } from "../lib/http.js";
import { loadProfile } from "../profile.js";
import { scoreListing } from "../scoring.js";
import type { Dependencies, ListingCandidate, RunSummary } from "../types.js";
import { discoverFromAtsBoard, expandSearchResult } from "./ats.js";
import { buildQueries } from "./queries.js";
import { discoverFromRss } from "./rss.js";
import { searchDuckDuckGo } from "./web.js";

async function collectSearchListings(baseDir: string, deps: Dependencies): Promise<ListingCandidate[]> {
  const config = loadConfig(baseDir);
  const queries = buildQueries(config);
  const listings: ListingCandidate[] = [];

  for (const query of queries) {
    try {
      const results = await searchDuckDuckGo(query, deps);
      let found = 0;
      for (const result of results.slice(0, config.search.maxResultsPerQuery)) {
        const expanded = await expandSearchResult(result, deps);
        listings.push(...expanded);
        found += expanded.length;
      }
      recordSearchRun(openDatabase(baseDir).db, query.lane, query.query, "search", "ok", found, found);
    } catch (error) {
      recordSearchRun(
        openDatabase(baseDir).db,
        query.lane,
        query.query,
        "search",
        "error",
        0,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return listings;
}

async function collectConfiguredSources(baseDir: string, deps: Dependencies): Promise<ListingCandidate[]> {
  const config = loadConfig(baseDir);
  const listings: ListingCandidate[] = [];
  const bundle = openDatabase(baseDir);

  for (const source of config.sources.rss) {
    try {
      const discovered = await discoverFromRss(source, deps);
      listings.push(...discovered);
      recordSearchRun(bundle.db, discovered[0]?.lane ?? "company_watch", source.url, "rss", "ok", discovered.length, discovered.length);
    } catch (error) {
      recordSearchRun(
        bundle.db,
        "company_watch",
        source.url,
        "rss",
        "error",
        0,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  for (const board of config.sources.atsBoards) {
    try {
      const discovered = await discoverFromAtsBoard(board, deps);
      listings.push(...discovered);
      recordSearchRun(bundle.db, board.lane ?? "company_watch", board.url, "ats", "ok", discovered.length, discovered.length);
    } catch (error) {
      recordSearchRun(
        bundle.db,
        board.lane ?? "company_watch",
        board.url,
        "ats",
        "error",
        0,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return listings;
}

export async function runDiscovery(baseDir: string, deps: Dependencies = createDefaultDependencies()): Promise<RunSummary> {
  const { db } = openDatabase(baseDir);
  const config = loadConfig(baseDir);
  const { profile } = loadProfile(baseDir);

  const rawListings = [
    ...(await collectSearchListings(baseDir, deps)),
    ...(await collectConfiguredSources(baseDir, deps)),
  ];

  const results = rawListings.map((listing) => {
    const scored = scoreListing(config, profile, listing);
    return upsertJob(db, config, listing, scored.score, scored.category, scored.rationale, scored.relevantProjects, profile);
  });

  return summarizeRun(results);
}

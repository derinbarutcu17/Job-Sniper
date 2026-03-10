import type { SearchLane, SearchQuery, SniperConfig } from "../types.js";

export function buildQueries(config: SniperConfig): SearchQuery[] {
  const queries: SearchQuery[] = [];

  (Object.keys(config.lanes) as SearchLane[]).forEach((lane) => {
    const laneConfig = config.lanes[lane];
    if (!laneConfig.enabled) {
      return;
    }

    for (const locale of ["tr", "en"] as const) {
      for (const query of laneConfig.queries[locale].slice(0, config.search.maxQueriesPerLane)) {
        queries.push({ lane, locale, query });
      }
    }
  });

  return queries;
}

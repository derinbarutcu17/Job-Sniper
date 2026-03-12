import type { ProfileSummary, SearchLane, SearchQuery, SniperConfig } from "../types.js";

const ATS_SITES = ["greenhouse.io", "jobs.lever.co", "ashbyhq.com", "workable.com", "teamtailor.com", "smartrecruiters.com", "recruitee.com", "personio.de", "wellfound.com"];

function laneRoleTokens(lane: SearchLane): string[] {
  switch (lane) {
    case "design_jobs":
      return ["product designer", "ux designer", "ui designer", "design engineer", "creative technologist"];
    case "ai_coding_jobs":
      return ["ai engineer", "llm engineer", "agent engineer", "automation engineer", "genai product builder"];
    case "company_watch":
      return ["AI startup", "product design startup", "creative AI company"];
  }
}

export function buildQueries(config: SniperConfig, profile: ProfileSummary): SearchQuery[] {
  const queries: SearchQuery[] = [];
  (Object.keys(config.lanes) as SearchLane[]).forEach((lane) => {
    if (!config.lanes[lane].enabled) return;
    const laneTerms = laneRoleTokens(lane);
    const profileTerms = profile.toolSignals.slice(0, 4);
    const locationTerms = [...config.search.priorityCities.slice(0, 1), ...config.search.priorityCountries.slice(0, 1)];

    const baseFamilies: Array<SearchQuery["family"]> = lane === "company_watch" ? ["company", "contact"] : ["job", "company", "contact"];
    for (const family of baseFamilies) {
      for (const locale of ["tr", "en"] as const) {
        const configured = config.lanes[lane].queries[locale];
        for (const query of configured.slice(0, config.search.maxQueriesPerLane)) {
          queries.push({ lane, locale, query, family, providerHints: [] });
        }
      }
    }

    for (const role of laneTerms) {
      for (const location of locationTerms) {
        queries.push({
          lane,
          locale: "en",
          query: `${role} ${location}`,
          family: lane === "company_watch" ? "company" : "job",
          providerHints: [],
        });
        queries.push({
          lane,
          locale: "en",
          query: `${role} remote ${profileTerms.join(" ")}`.trim(),
          family: lane === "company_watch" ? "company" : "job",
          providerHints: ["remote"],
        });
      }
      for (const site of ATS_SITES) {
        queries.push({
          lane,
          locale: "en",
          query: `${role} site:${site}`,
          family: "job",
          providerHints: [site],
        });
      }
    }

    for (const term of profileTerms) {
      queries.push({
        lane,
        locale: "en",
        query: `${term} careers startup`,
        family: lane === "company_watch" ? "company" : "contact",
        providerHints: ["startup"],
      });
    }
  });

  return queries;
}

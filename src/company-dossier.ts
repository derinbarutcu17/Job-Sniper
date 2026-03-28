import type Database from "better-sqlite3";
import type { CompanyDecisionSnapshot, OpportunityRecommendation, RecommendedRoute } from "./types.js";

function priorityBand(score: number): CompanyDecisionSnapshot["priorityBand"] {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function buildCompanyDecisionSnapshot(
  company: Record<string, unknown>,
  jobs: Array<Record<string, unknown>>,
  directContactCount: number,
): CompanyDecisionSnapshot {
  const openRoleCount = Number(company.open_role_count ?? jobs.length ?? 0);
  const startupScore = Number(company.startup_score ?? 0);
  const contactabilityScore = Number(company.contactability_score ?? 0);
  const companyFitScore = Number(company.company_fit_score ?? 0);
  const hasFounderSurface = Boolean(company.team_url || company.about_url);
  const reachableNow = directContactCount > 0 || hasFounderSurface;
  const composite = startupScore + contactabilityScore + companyFitScore + openRoleCount * 4;

  let recommendation: OpportunityRecommendation = "watch";
  let bestRoute: RecommendedRoute = "watch_company";
  let recommendationReason = "Useful to monitor, but not urgent yet.";

  if (reachableNow && startupScore >= 8 && companyFitScore >= 0) {
    recommendation = "cold_email";
    bestRoute = directContactCount > 0 ? "direct_email_first" : "founder_or_team_reachout";
    recommendationReason = "The company looks reachable now and has enough hiring/startup signal to justify proactive outreach.";
  } else if (openRoleCount > 0 && companyFitScore >= 0) {
    recommendation = "enrich_first";
    bestRoute = directContactCount > 0 ? "ats_plus_cold_email" : "watch_company";
    recommendationReason = "There are active role signals, but route quality still benefits from one more enrichment pass.";
  } else if (composite < 12) {
    recommendation = "discard";
    bestRoute = "no_action";
    recommendationReason = "The company currently has low reachability and weak hiring signal.";
  }

  const topJob = jobs[0];
  const pitchTheme = String(topJob?.pitch_theme ?? (startupScore >= 8 ? "startup_speed" : "generalist"));
  const pitchAngle = String(
    topJob?.pitch_angle ??
      (startupScore >= 8
        ? "Lead with speed, ambiguity tolerance, and ability to help a small team ship."
        : "Lead with the clearest overlap between your profile and the company's current product direction."),
  );

  return {
    recommendation,
    bestRoute,
    pitchTheme: pitchTheme as CompanyDecisionSnapshot["pitchTheme"],
    pitchAngle,
    pitchEvidence: [],
    directContactCount,
    reachableNow,
    priorityBand: priorityBand(composite),
    recommendationReason,
  };
}

export function renderCompanyDossier(
  company: Record<string, unknown>,
  jobs: Array<Record<string, unknown>>,
  contacts: Array<Record<string, unknown>>,
): string {
  const directContactCount = contacts.filter((contact) => String(contact.email ?? "") || String(contact.linkedin_url ?? "")).length;
  const snapshot = buildCompanyDecisionSnapshot(company, jobs, directContactCount);
  return [
    `${String(company.name ?? "")}`,
    `Recommendation: ${snapshot.recommendation}`,
    `Best route: ${snapshot.bestRoute}`,
    `Priority: ${snapshot.priorityBand}`,
    `Why it matters: ${snapshot.recommendationReason}`,
    `Pitch theme: ${snapshot.pitchTheme}`,
    `Pitch angle: ${snapshot.pitchAngle}`,
    `Contacts found: ${directContactCount}`,
    `Open roles tracked: ${jobs.length}`,
    jobs.length
      ? `Top roles: ${jobs.slice(0, 3).map((job) => `${String(job.title ?? "")} (${String(job.recommendation ?? "watch")})`).join("; ")}`
      : "Top roles: none tracked",
  ].join("\n");
}

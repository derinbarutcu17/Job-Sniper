import { getJobById, openDatabase, saveOutreachDraft } from "./db.js";
import { loadProfile } from "./profile.js";

export function draftOutreach(baseDir: string, jobId: number): string {
  const { db } = openDatabase(baseDir);
  const job = getJobById(db, jobId);
  if (!job) {
    throw new Error(`Job ${jobId} was not found.`);
  }

  const { profile } = loadProfile(baseDir);
  const relevant = job.relevant_projects
    ? job.relevant_projects.split(",").map((entry) => entry.trim()).filter(Boolean)
    : profile.toolSignals.slice(0, 3);
  const intro = job.language === "tr" ? "Merhaba" : "Hello";
  const close = job.language === "tr" ? "Sevgiler" : "Best";
  const draft = [
    `${intro} ${job.company_name} ekibi,`,
    "",
    `Istanbul-first role scan'imde ${job.title} pozisyonunu gördüm ve profilimle güçlü bir eşleşme buldum.`,
    `Öne çıkan sinyaller: ${relevant.join(", ") || "product building, design, AI tooling"}.`,
    `Kısa özet: ${job.match_rationale || "This role matches my current focus across design and AI-enabled product work."}`,
    "",
    "If useful, I can share a concise portfolio and discuss how I can help ship quickly.",
    "",
    `${close},`,
    "[Your Name]",
  ].join("\n");

  saveOutreachDraft(db, jobId, draft);
  return draft;
}

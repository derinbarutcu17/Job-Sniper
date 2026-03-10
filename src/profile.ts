import fs from "node:fs";
import path from "node:path";
import pdf from "pdf-parse";
import { resolveProfilePath } from "./lib/paths.js";
import { includesAny, normalizeText, pickTopSignals, summarizeToLine } from "./lib/text.js";
import type { ProfileSummary } from "./types.js";

const DESIGN_SIGNALS = [
  "figma",
  "product design",
  "ux",
  "ui",
  "design systems",
  "visual design",
  "brand",
  "motion",
  "creative",
];
const AI_SIGNALS = [
  "ai",
  "llm",
  "agent",
  "automation",
  "typescript",
  "node",
  "python",
  "developer tools",
  "full-stack",
  "openai",
];

async function readProfileInput(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (fs.existsSync(trimmed) && fs.lstatSync(trimmed).isFile()) {
    const extension = path.extname(trimmed).toLowerCase();
    if (extension === ".pdf") {
      const buffer = fs.readFileSync(trimmed);
      const parsed = await pdf(buffer);
      return parsed.text.trim();
    }
    return fs.readFileSync(trimmed, "utf8").trim();
  }

  return trimmed;
}

export function deriveProfileSummary(content: string): ProfileSummary {
  const normalized = normalizeText(content);
  const roleFamilies: string[] = [];

  if (includesAny(normalized, DESIGN_SIGNALS)) {
    roleFamilies.push("design");
  }
  if (includesAny(normalized, AI_SIGNALS)) {
    roleFamilies.push("ai_coding");
  }
  if (roleFamilies.length === 0) {
    roleFamilies.push("generalist");
  }

  const seniorityCeiling = includesAny(normalized, ["lead", "senior", "principal", "staff"])
    ? "senior"
    : "mid";

  const preferredLocations = [
    ...(includesAny(normalized, ["istanbul", "istanbul"]) ? ["Istanbul"] : []),
    ...(includesAny(normalized, ["remote", "uzaktan"]) ? ["Remote"] : []),
    ...(includesAny(normalized, ["turkiye", "türkiye", "turkey"]) ? ["Turkey"] : []),
  ];

  const languagePreference = [
    ...(includesAny(normalized, ["turkish", "türkçe", "turkce"]) ? ["tr"] : []),
    ...(includesAny(normalized, ["english", "ingilizce"]) ? ["en"] : []),
  ];

  const toolSignals = [
    ...pickTopSignals(normalized, DESIGN_SIGNALS, 5),
    ...pickTopSignals(normalized, AI_SIGNALS, 5),
  ].slice(0, 8);

  return {
    roleFamilies,
    seniorityCeiling,
    preferredLocations,
    languagePreference: languagePreference.length ? languagePreference : ["tr", "en"],
    toolSignals: [...new Set(toolSignals)],
    summary: summarizeToLine(content, 320),
  };
}

export async function onboardProfile(
  baseDir: string,
  input: string,
): Promise<{ cvText: string; profile: ProfileSummary }> {
  const content = await readProfileInput(input);
  if (!content.trim()) {
    throw new Error("No CV content provided. Pass text, pipe stdin, or give a file path.");
  }

  const cvPath = resolveProfilePath(baseDir, "cv.md");
  const profilePath = resolveProfilePath(baseDir, "profile.json");
  fs.writeFileSync(cvPath, `${content.trim()}\n`);

  const profile = deriveProfileSummary(content);
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  return { cvText: content, profile };
}

export function loadProfile(baseDir: string): { cvText: string; profile: ProfileSummary } {
  const cvPath = resolveProfilePath(baseDir, "cv.md");
  const profilePath = resolveProfilePath(baseDir, "profile.json");

  if (!fs.existsSync(cvPath)) {
    throw new Error("No profile found. Run `onboard` first with CV text or a file path.");
  }

  const cvText = fs.readFileSync(cvPath, "utf8");
  if (fs.existsSync(profilePath)) {
    return {
      cvText,
      profile: JSON.parse(fs.readFileSync(profilePath, "utf8")) as ProfileSummary,
    };
  }

  const profile = deriveProfileSummary(cvText);
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  return { cvText, profile };
}

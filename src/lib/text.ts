export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[İI]/g, "i")
    .toLowerCase();
}

export function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => (value ?? "").trim()).filter(Boolean))];
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeToLine(value: string, max = 200): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

export function includesAny(text: string, candidates: string[]): boolean {
  const normalized = normalizeText(text);
  return candidates.some((candidate) => normalized.includes(normalizeText(candidate)));
}

export function pickTopSignals(text: string, candidates: string[], limit = 5): string[] {
  const normalized = normalizeText(text);
  return candidates.filter((candidate) => normalized.includes(normalizeText(candidate))).slice(0, limit);
}

import { slugify } from "./text.js";

export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["gh_jid", "gh_src", "source", "ref"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.trim();
  }
}

export function domainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function canonicalJobKey(url: string, externalId: string, title: string, company: string): string {
  if (externalId.trim()) {
    return `job:${slugify(externalId)}`;
  }
  if (url.trim()) {
    return `job:${slugify(normalizeUrl(url))}`;
  }
  return `job:${slugify(`${company}-${title}`)}`;
}

export function canonicalCompanyKey(name: string, domain: string): string {
  if (domain.trim()) {
    return `company:${slugify(domain)}`;
  }
  return `company:${slugify(name)}`;
}

export function canonicalContactKey(email: string, linkedinUrl: string, name: string, companyKey: string): string {
  if (email.trim()) {
    return `contact:${slugify(email)}`;
  }
  if (linkedinUrl.trim()) {
    return `contact:${slugify(normalizeUrl(linkedinUrl))}`;
  }
  return `contact:${slugify(`${companyKey}-${name}`)}`;
}

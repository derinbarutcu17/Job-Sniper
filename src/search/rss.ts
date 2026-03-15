import { XMLParser } from "fast-xml-parser";
import { decodeEntities, summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import type { Dependencies, ListingCandidate, RssSource, SearchLane } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

function inferLane(title: string, sourceName: string): SearchLane {
  const haystack = `${title} ${sourceName}`.toLowerCase();
  if (haystack.includes("design") || haystack.includes("tasarım")) return "design_jobs";
  if (haystack.includes("career") || haystack.includes("company") || haystack.includes("startup")) return "company_watch";
  return "ai_coding_jobs";
}

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("uzaktan")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

export async function discoverFromRss(source: RssSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const response = await deps.fetch(source.url);
  if (!response.ok) {
    throw new Error(`RSS fetch failed with ${response.status} for ${source.url}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const items = Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : [];

  return items.map((item) => {
    const record = item as Record<string, unknown>;
    const title = decodeEntities(String(record.title ?? "Untitled role"));
    const url = String(record.link ?? "");
    const description = summarizeToLine(String(record.description ?? ""), 1200);
    const lane = inferLane(title, source.name);
    const [jobTitle, company = "Unknown"] =
      title.includes(" // ") ? title.split(" // ", 2) : title.includes(" at ") ? title.split(" at ", 2) : [title];

    return {
      lane,
      externalId: url,
      title: jobTitle.trim(),
      titleFamily: "",
      company: company.trim(),
      location: lane === "design_jobs" ? "Berlin/Remote" : "Remote",
      country: "",
      language: /[ığüşöçİĞÜŞÖÇ]/.test(description) ? "tr" : "en",
      workModel: inferWorkModel(description),
      employmentType: "",
      salary: "",
      description,
      url,
      applyUrl: url,
      source: source.name,
      sourceType: "rss",
      sourceUrls: uniqueNonEmpty([url, source.url]),
      companyUrl: "",
      careersUrl: url,
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: String(record.pubDate ?? ""),
      validThrough: "",
      department: "",
      experienceYearsText: "",
      remoteScope: "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.7,
      sourceConfidence: 0.75,
      isRealJobPage: true,
      raw: record,
    } satisfies ListingCandidate;
  });
}

import { XMLParser } from "fast-xml-parser";
import { decodeEntities, summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import type { Dependencies, ListingCandidate, RssSource, SearchLane } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

function inferLane(title: string, sourceName: string): SearchLane {
  const haystack = `${title} ${sourceName}`.toLowerCase();
  if (haystack.includes("design")) {
    return "design_jobs";
  }
  if (haystack.includes("career") || haystack.includes("company")) {
    return "company_watch";
  }
  return "ai_coding_jobs";
}

export async function discoverFromRss(
  source: RssSource,
  deps: Dependencies,
): Promise<ListingCandidate[]> {
  const response = await deps.fetch(source.url);
  if (!response.ok) {
    throw new Error(`RSS fetch failed with ${response.status} for ${source.url}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  const items = Array.isArray(channel?.item) ? channel?.item : channel?.item ? [channel.item] : [];

  return items.map((item) => {
    const record = item as Record<string, unknown>;
    const title = decodeEntities(String(record.title ?? "Untitled role"));
    const link = String(record.link ?? "");
    const description = summarizeToLine(String(record.description ?? ""), 600);
    const lane = inferLane(title, source.name);
    const [jobTitle, company = "Unknown"] =
      title.includes(" // ") ? title.split(" // ", 2) : title.includes(" at ") ? title.split(" at ", 2) : [title];

    return {
      lane,
      externalId: link,
      title: jobTitle.trim(),
      company: company.trim(),
      location: lane === "design_jobs" ? "Istanbul/Remote" : "Remote",
      country: "",
      language: "en",
      workModel: link.toLowerCase().includes("remote") ? "remote" : "unknown",
      employmentType: "",
      salary: "",
      description,
      url: link,
      source: source.name,
      sourceType: "rss",
      sourceUrls: uniqueNonEmpty([link, source.url]),
      companyUrl: "",
      careersUrl: link,
      companyLinkedinUrl: "",
      publicContacts: [],
      publicEmails: [],
      raw: record,
    } satisfies ListingCandidate;
  });
}

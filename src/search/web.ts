import * as cheerio from "cheerio";
import { normalizeUrl } from "../lib/url.js";
import { summarizeToLine } from "../lib/text.js";
import type { Dependencies, SearchQuery, SearchResult } from "../types.js";

function decodeDuckDuckGoUrl(raw: string): string {
  // DuckDuckGo returns protocol-relative redirect URLs like:
  // //duckduckgo.com/l/?uddg=https%3A%2F%2Factual-url.com
  try {
    const absolute = raw.startsWith("//") ? `https:${raw}` : raw;
    const parsed = new URL(absolute);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.searchParams.has("uddg")) {
      return decodeURIComponent(parsed.searchParams.get("uddg")!);
    }
    return absolute;
  } catch {
    return raw;
  }
}

export async function searchDuckDuckGo(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]> {
  const response = await deps.fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.query)}`);
  if (!response.ok) {
    throw new Error(`Web search failed with ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".result").each((_, element) => {
    const anchor = $(element).find(".result__title a");
    const rawHref = anchor.attr("href") ?? "";
    const url = normalizeUrl(decodeDuckDuckGoUrl(rawHref));
    const title = anchor.text().trim();
    const snippet = summarizeToLine($(element).find(".result__snippet").text().trim(), 220);
    if (!url || !title) {
      return;
    }
    results.push({
      lane: query.lane,
      title,
      url,
      snippet,
      source: "duckduckgo",
    });
  });

  return results;
}

import * as cheerio from "cheerio";
import { summarizeToLine } from "../lib/text.js";
import { normalizeUrl } from "../lib/url.js";
import type { Dependencies, SearchProvider, SearchQuery, SearchResult } from "../types.js";

export class DuckDuckGoProvider implements SearchProvider {
  name = "duckduckgo";

  async search(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]> {
    const response = await deps.fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.query)}`);
    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed with ${response.status}`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(".result").each((_, element) => {
      const anchor = $(element).find(".result__title a");
      const title = anchor.text().trim();
      const url = normalizeUrl(anchor.attr("href") ?? "");
      const snippet = summarizeToLine($(element).find(".result__snippet").text().trim(), 220);
      if (!title || !url) return;
      results.push({
        lane: query.lane,
        title,
        url,
        snippet,
        source: "search",
        query: query.query,
        provider: this.name,
      });
    });

    return results;
  }
}

export function getSearchProviders(): SearchProvider[] {
  return [new DuckDuckGoProvider()];
}

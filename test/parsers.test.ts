import { describe, expect, it } from "vitest";
import { discoverFromAtsBoard, expandSearchResult } from "../src/search/ats.js";
import { canonicalJobKey } from "../src/lib/url.js";
import { discoverFromRss } from "../src/search/rss.js";
import { fixture, makeFetchStub } from "./helpers.js";

describe("parsers", () => {
  it("parses RSS feed entries", async () => {
    const deps = makeFetchStub({
      "https://feed.example.com/rss": { body: fixture("sample-rss.xml") },
    });
    const listings = await discoverFromRss(
      { name: "Sample Design Feed", url: "https://feed.example.com/rss" },
      deps,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe("Product Designer");
    expect(listings[0]?.company).toBe("ModaAI");
  });

  it("parses Berlin job JSON-LD and extracts public contacts", async () => {
    const deps = makeFetchStub({
      "https://jobs.example.com/turkish-design-role": { body: fixture("turkish-job.html") },
    });
    const listings = await expandSearchResult(
      {
        lane: "design_jobs",
        title: "UI/UX Designer",
        url: "https://jobs.example.com/turkish-design-role",
        snippet: "Berlin hybrid product design role.",
        source: "search",
        query: "ui ux berlin",
        provider: "duckduckgo",
      },
      deps,
    );
    expect(listings[0]?.company).toBe("Berlin Studio");
    expect(listings[0]?.language).toBe("en");
    expect(listings[0]?.publicContacts.some((contact) => contact.email === "hello@berlinstudio.com")).toBe(true);
  });

  it("normalizes canonical job keys from tracking URLs", () => {
    const keyA = canonicalJobKey(
      "https://jobs.example.com/agent-engineer?utm_source=x",
      "",
      "Agent Engineer",
      "Agent Forge",
    );
    const keyB = canonicalJobKey(
      "https://jobs.example.com/agent-engineer?utm_source=y",
      "",
      "Agent Engineer",
      "Agent Forge",
    );
    expect(keyA).toBe(keyB);
  });

  it("falls back to search results when Wellfound board is blocked by a challenge page", async () => {
    const deps = makeFetchStub({
      "https://wellfound.com/location/berlin-berlin": {
        body: "<html><body><iframe title='DataDome CAPTCHA' src='https://geo.captcha-delivery.com/captcha/'></iframe></body></html>",
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22product%20designer%22%20%22Berlin%22": {
        body: fixture("wellfound-search-results.html"),
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Wellfound Design Jobs",
        provider: "wellfound",
        url: "https://wellfound.com/location/berlin-berlin",
        lane: "design_jobs",
      },
      deps,
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]?.source).toBe("Wellfound search fallback");
    expect(listings[0]?.url).toContain("wellfound.com");
  });
});

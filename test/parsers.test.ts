import { describe, expect, it } from "vitest";
import { expandSearchResult } from "../src/search/ats.js";
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

  it("parses Turkish job JSON-LD and extracts public contacts", async () => {
    const deps = makeFetchStub({
      "https://jobs.example.com/turkish-design-role": { body: fixture("turkish-job.html") },
    });
    const listings = await expandSearchResult(
      {
        lane: "design_jobs",
        title: "UI/UX Tasarımcı",
        url: "https://jobs.example.com/turkish-design-role",
        snippet: "İstanbul hibrit ürün tasarım rolü.",
        source: "search",
        query: "ui ux istanbul",
        provider: "duckduckgo",
      },
      deps,
    );
    expect(listings[0]?.company).toBe("Istanbul Studio");
    expect(listings[0]?.language).toBe("tr");
    expect(listings[0]?.publicContacts.some((contact) => contact.email === "hello@istanbulstudio.com")).toBe(true);
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
});

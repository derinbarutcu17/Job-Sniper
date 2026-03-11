import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Dependencies, HttpResponseLike } from "../src/types.js";

export function fixture(name: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
}

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sniper-test-"));
}

function response(body: string, status = 200, jsonValue?: unknown): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => (jsonValue === undefined ? JSON.parse(body) : jsonValue),
  };
}

export function makeFetchStub(routes: Record<string, { body: string; status?: number; json?: unknown }>): Dependencies {
  return {
    fetch: async (input) => {
      const route = routes[input];
      if (!route && String(input).startsWith("https://html.duckduckgo.com/html/?q=")) {
        return response("<html><body></body></html>", 200);
      }
      if (!route) {
        throw new Error(`Missing route for ${input}`);
      }
      return response(route.body, route.status, route.json);
    },
    now: () => new Date("2026-03-10T10:00:00Z"),
  };
}

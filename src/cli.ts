import { getBaseDir } from "./lib/paths.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { getDefaultCompanyWatchLane } from "./role-packs.js";
import type { SearchLane } from "./types.js";

function help(): string {
  return [
    "sniper <subcommand>",
    "",
    "Commands:",
    "  onboard <text-or-file>",
    "  run [--lane <lane-id>] [--company-watch]",
    "  digest [limit]",
    "  shortlist [limit]",
    "  draft <job-id>",
    "  explain <job-id>",
    "  blacklist add [--company | --keyword] [--lane <lane>] <term>",
    "  sheet sync",
    "  sheet pull",
    "  companies [limit]",
    "  contacts [company-id-or-key]",
    "  enrich company <company-id-or-key>",
    "  requeue <url> [lane]",
    "  sources test",
    "  stats",
    "  export json [path]",
  ].join("\n");
}

function parseLane(input: string | undefined, baseDir: string): SearchLane | undefined {
  if (!input) return undefined;
  const config = loadConfig(baseDir);
  if (config.lanes[input]) {
    return input;
  }
  throw new Error(`Invalid lane: ${input}. Configured lanes: ${Object.keys(config.lanes).join(", ")}`);
}

export async function runCli(argv: string[], baseDir = getBaseDir()): Promise<string> {
  const [command, ...rest] = argv;
  const app = createApp(baseDir);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return help();
  }

  if (command === "onboard") {
    return app.onboard(rest.join(" "));
  }

  if (command === "run") {
    let lane: SearchLane | undefined;
    let companyWatchOnly = false;
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--lane") {
        lane = parseLane(rest[index + 1], baseDir);
        index += 1;
      } else if (token === "--company-watch") {
        companyWatchOnly = true;
      }
    }
    return app.run({ lane, companyWatchOnly });
  }

  if (command === "digest") {
    return app.digest(Number(rest[0] ?? 5));
  }

  if (command === "shortlist") {
    return app.shortlist(Number(rest[0] ?? 10));
  }

  if (command === "draft") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("draft requires a numeric job ID.");
    }
    return app.draft(jobId);
  }

  if (command === "explain") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("explain requires a numeric job ID.");
    }
    return app.explain(jobId);
  }

  if (command === "blacklist" && rest[0] === "add") {
    let mode: "company" | "keyword" = "keyword";
    let lane: SearchLane | undefined;
    const terms: string[] = [];
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--company") {
        mode = "company";
      } else if (token === "--keyword") {
        mode = "keyword";
      } else if (token === "--lane") {
        lane = parseLane(rest[index + 1], baseDir);
        index += 1;
      } else {
        terms.push(token);
      }
    }
    const term = terms.join(" ").trim();
    if (!term) {
      throw new Error("blacklist add requires a company or keyword.");
    }
    return app.blacklistAdd({ term, mode, lane });
  }

  if (command === "sheet" && rest[0] === "sync") {
    return app.sheetSync();
  }

  if (command === "sheet" && rest[0] === "pull") {
    return app.sheetPull();
  }

  if (command === "companies") {
    return app.companies(Number(rest[0] ?? 10));
  }

  if (command === "contacts") {
    return app.contacts(rest[0]);
  }

  if (command === "enrich" && rest[0] === "company") {
    const companyRef = rest.slice(1).join(" ").trim();
    if (!companyRef) {
      throw new Error("enrich company requires a company id or key.");
    }
    return app.enrichCompany(companyRef);
  }

  if (command === "requeue") {
    const url = rest[0];
    if (!url) {
      throw new Error("requeue requires a URL.");
    }
    return app.requeue(url, parseLane(rest[1], baseDir) ?? getDefaultCompanyWatchLane(loadConfig(baseDir)));
  }

  if (command === "sources" && rest[0] === "test") {
    return app.sourcesTest();
  }

  if (command === "stats") {
    return app.stats();
  }

  if (command === "export" && rest[0] === "json") {
    return app.exportJson(rest[1]);
  }

  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((output) => {
      process.stdout.write(`${output}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}

import { getBaseDir } from "./lib/paths.js";
import { createApp } from "./app.js";

function help(): string {
  return [
    "sniper <subcommand>",
    "",
    "Commands:",
    "  onboard <text-or-file>",
    "  run",
    "  digest [limit]",
    "  draft <job-id>",
    "  blacklist add <term>",
    "  sheet sync",
    "  sheet pull",
    "  companies [limit]",
  ].join("\n");
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
    return app.run();
  }

  if (command === "digest") {
    return app.digest(Number(rest[0] ?? 5));
  }

  if (command === "draft") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("draft requires a numeric job ID.");
    }
    return app.draft(jobId);
  }

  if (command === "blacklist" && rest[0] === "add") {
    const term = rest.slice(1).join(" ").trim();
    if (!term) {
      throw new Error("blacklist add requires a company or keyword.");
    }
    return app.blacklistAdd(term);
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

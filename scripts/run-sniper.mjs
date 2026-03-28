import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ensureDependencies() {
  if (existsSync(path.join(baseDir, "node_modules", "tsx"))) {
    return;
  }

  const install = spawnSync("npm", ["install"], {
    cwd: baseDir,
    stdio: "inherit",
    env: process.env,
  });

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

ensureDependencies();

const result = spawnSync("node", ["--import", "tsx", path.join(baseDir, "scripts", "run-sniper-cli.mjs"), ...process.argv.slice(2)], {
  cwd: baseDir,
  stdio: "inherit",
  env: { ...process.env, SNIPER_BASE_DIR: baseDir },
});

process.exit(result.status ?? 1);

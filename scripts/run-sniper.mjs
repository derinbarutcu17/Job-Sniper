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

const tsxCli = path.join(baseDir, "node_modules", ".bin", "tsx");
const cliPath = path.join(baseDir, "src", "cli.ts");
const result = spawnSync(tsxCli, [cliPath, ...process.argv.slice(2)], {
  cwd: baseDir,
  stdio: "inherit",
  env: { ...process.env, SNIPER_BASE_DIR: baseDir },
});

process.exit(result.status ?? 1);

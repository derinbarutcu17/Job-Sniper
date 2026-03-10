import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getBaseDir(): string {
  if (process.env.SNIPER_BASE_DIR) {
    return process.env.SNIPER_BASE_DIR;
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveDataPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveProfilePath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "profile");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { makeTempDir } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";

describe("cli", () => {
  it("supports onboard and digest smoke flow", async () => {
    const baseDir = makeTempDir();
    const onboard = await runCli(
      ["onboard", "I build AI tools and design systems in Istanbul using Figma, TypeScript, and Python."],
      baseDir,
    );
    expect(onboard).toContain("Profile synced");

    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const digest = await runCli(["digest"], baseDir);
    expect(digest).toContain("No ranked jobs yet");
  });

  it("rejects invalid draft ids", async () => {
    const baseDir = makeTempDir();
    await expect(runCli(["draft", "nope"], baseDir)).rejects.toThrow("draft requires a numeric job ID");
  });
});

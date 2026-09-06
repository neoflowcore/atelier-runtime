import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeBrowserRuntime } from "../runtime/browser-runtime.mjs";

async function targetDir() {
  return await mkdtemp(join(tmpdir(), "atelier-g6-"));
}

test("G6 skips when browser script is undeclared", async () => {
  const directory = await targetDir();
  try {
    const result = await executeBrowserRuntime(directory, { scripts: {} });
    assert.deepEqual(result, {
      ok: true,
      playwrightCli: "SKIPPED",
      chromiumProvision: "SKIPPED",
      browserScript: "SKIPPED"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("G6 blocks declared browser stage without project Playwright CLI", async () => {
  const directory = await targetDir();
  try {
    await mkdir(join(directory, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ scripts: { "test:e2e": "playwright test" } }));
    const result = await executeBrowserRuntime(directory, { scripts: { browser: "test:e2e" } });
    assert.deepEqual(result, {
      ok: false,
      classification: "BLOCKED",
      failureStage: "BROWSER",
      failureReason: "MISSING_PLAYWRIGHT_CLI"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("G6 classifies Chromium provisioning failure as INFRA_FAILURE", async () => {
  const directory = await targetDir();
  try {
    const binDirectory = join(directory, "node_modules", ".bin");
    const playwrightCli = join(binDirectory, "playwright");
    await mkdir(binDirectory, { recursive: true });
    await writeFile(playwrightCli, "#!/usr/bin/env node\nprocess.exit(23);\n");
    await chmod(playwrightCli, 0o755);

    const result = await executeBrowserRuntime(directory, { scripts: { browser: "browser" } });
    assert.deepEqual(result, {
      ok: false,
      classification: "INFRA_FAILURE",
      failureStage: "BROWSER",
      failureReason: "CHROMIUM_PROVISION_EXIT_23"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

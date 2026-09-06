import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export const BROWSER_TIMEOUT_MS = 5 * 60 * 1000;
export const PROVISION_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 1500;

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function runProcess(command, args, { cwd, timeoutMs }) {
  return await new Promise((resolvePromise) => {
    let finished = false;
    let timedOut = false;
    let timeoutTimer = null;
    let killTimer = null;
    let child;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise(result);
    };

    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        detached: true,
        stdio: "inherit",
        env: process.env
      });
    } catch (error) {
      resolvePromise({ ok: false, kind: "spawn", code: error?.code ?? "UNKNOWN" });
      return;
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        signalProcessGroup(child, "SIGTERM");
        killTimer = setTimeout(() => {
          try {
            signalProcessGroup(child, "SIGKILL");
          } catch {
            // The process may have exited between TERM and KILL.
          }
        }, KILL_GRACE_MS);
      } catch {
        finish({ ok: false, kind: "timeout" });
      }
    }, timeoutMs);

    child.once("error", (error) => {
      finish({ ok: false, kind: "spawn", code: error?.code ?? "UNKNOWN" });
    });

    child.once("exit", (code, signal) => {
      if (timedOut) {
        finish({ ok: false, kind: "timeout" });
      } else if (code === 0) {
        finish({ ok: true });
      } else {
        finish({ ok: false, kind: "exit", code, signal });
      }
    });
  });
}

function exitDetail(result) {
  if (result.code !== null && result.code !== undefined) return `EXIT_${result.code}`;
  if (result.signal) return `SIGNAL_${result.signal}`;
  return "UNKNOWN";
}

export async function executeBrowserRuntime(targetDirectory, contract) {
  const browserScript = contract?.scripts?.browser;
  if (!browserScript) {
    return {
      ok: true,
      playwrightCli: "SKIPPED",
      chromiumProvision: "SKIPPED",
      browserScript: "SKIPPED"
    };
  }

  const playwrightCli = resolve(targetDirectory, "node_modules", ".bin", "playwright");
  try {
    await access(playwrightCli, fsConstants.X_OK);
  } catch {
    return {
      ok: false,
      classification: "BLOCKED",
      failureStage: "BROWSER",
      failureReason: "MISSING_PLAYWRIGHT_CLI"
    };
  }

  const provision = await runProcess(
    playwrightCli,
    ["install", "--with-deps", "chromium"],
    { cwd: targetDirectory, timeoutMs: PROVISION_TIMEOUT_MS }
  );
  if (!provision.ok) {
    if (provision.kind === "timeout") {
      return {
        ok: false,
        classification: "TIMEOUT",
        failureStage: "BROWSER",
        failureReason: "CHROMIUM_PROVISION_TIMEOUT"
      };
    }
    return {
      ok: false,
      classification: "INFRA_FAILURE",
      failureStage: "BROWSER",
      failureReason: `CHROMIUM_PROVISION_${provision.kind === "spawn" ? `SPAWN_${provision.code}` : exitDetail(provision)}`
    };
  }

  const browser = await runProcess(
    "npm",
    ["run", browserScript],
    { cwd: targetDirectory, timeoutMs: BROWSER_TIMEOUT_MS }
  );
  if (!browser.ok) {
    if (browser.kind === "timeout") {
      return {
        ok: false,
        classification: "TIMEOUT",
        failureStage: "BROWSER",
        failureReason: "BROWSER_SCRIPT_TIMEOUT"
      };
    }
    if (browser.kind === "spawn") {
      return {
        ok: false,
        classification: "INFRA_FAILURE",
        failureStage: "BROWSER",
        failureReason: `BROWSER_SCRIPT_SPAWN_${browser.code}`
      };
    }
    return {
      ok: false,
      classification: "APP_FAILURE",
      failureStage: "BROWSER",
      failureReason: `BROWSER_SCRIPT_${exitDetail(browser)}`
    };
  }

  return {
    ok: true,
    playwrightCli: "PASS",
    chromiumProvision: "PASS",
    browserScript: "PASS"
  };
}

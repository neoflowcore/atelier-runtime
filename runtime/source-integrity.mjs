import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

export async function captureTrackedSourceState(cwd) {
  return {
    head_sha: await git(cwd, ["rev-parse", "HEAD"]),
    tree_sha: await git(cwd, ["rev-parse", "HEAD^{tree}"]),
    tracked_status: await git(cwd, ["status", "--porcelain", "--untracked-files=no"])
  };
}

export function trackedSourceChanged(before, after) {
  return before.head_sha !== after.head_sha ||
    before.tree_sha !== after.tree_sha ||
    before.tracked_status !== after.tracked_status;
}

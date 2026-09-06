import { spawnSync } from "node:child_process";
import { captureTrackedSourceState, trackedSourceChanged } from "./source-integrity.mjs";

export const G4_STAGE_ORDER = Object.freeze(["format", "lint", "typecheck", "build", "test", "integration"]);

export function declaredStagePlan(contract) {
  return G4_STAGE_ORDER.map((slot) => ({
    slot,
    script: contract?.scripts?.[slot] ?? null,
    state: contract?.scripts?.[slot] ? "NOT_RUN" : "SKIPPED"
  }));
}

function runNpm(cwd, args) {
  return spawnSync("npm", args, { cwd, stdio: "inherit", shell: false }).status ?? 1;
}

export async function executeLockedStages(cwd, contract) {
  const before = await captureTrackedSourceState(cwd);
  const stages = declaredStagePlan(contract);
  let failureStage = null;
  let exitCode = runNpm(cwd, ["ci"]);
  console.log(`G4_STAGE_INSTALL=${exitCode === 0 ? "PASS" : "FAIL"}`);
  if (exitCode !== 0) failureStage = "install";

  for (const stage of stages) {
    if (!stage.script) {
      console.log(`G4_STAGE_${stage.slot.toUpperCase()}=SKIPPED`);
      continue;
    }
    if (failureStage) {
      console.log(`G4_STAGE_${stage.slot.toUpperCase()}=NOT_RUN`);
      continue;
    }
    exitCode = runNpm(cwd, ["run", stage.script]);
    stage.state = exitCode === 0 ? "PASS" : "FAIL";
    console.log(`G4_STAGE_${stage.slot.toUpperCase()}=${stage.state}`);
    if (exitCode !== 0) failureStage = stage.slot;
  }

  const after = await captureTrackedSourceState(cwd);
  const sourceChanged = trackedSourceChanged(before, after);
  console.log(`G4_TRACKED_SOURCE_INTEGRITY=${sourceChanged ? "FAIL" : "PASS"}`);
  if (sourceChanged) return { ok: false, exitCode: 3, failureStage: "source_integrity", stages };
  if (failureStage) return { ok: false, exitCode: exitCode || 1, failureStage, stages };
  return { ok: true, exitCode: 0, failureStage: null, stages };
}

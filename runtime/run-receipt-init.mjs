import { join, resolve } from "node:path";
import { captureReceiptStart } from "./receipt.mjs";
import { evidenceDirectory, writeJsonAtomic } from "./evidence.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");
const runtimeDirectory = resolve(process.argv[3] ?? "runtime");
const start = await captureReceiptStart(targetDirectory, runtimeDirectory);
await writeJsonAtomic(join(evidenceDirectory(), "start.json"), start);
console.log("G7_RECEIPT_INIT=PASS");

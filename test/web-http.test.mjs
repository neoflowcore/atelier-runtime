import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { executeWebHttpRuntime, validateWebContract } from "../runtime/web-runtime.mjs";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function makeTarget({ routeStatus = 204, expectedStatus = 204, exitImmediately = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "atelier-g5-"));
  const port = await freePort();
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "g5-fixture",
    private: true,
    type: "module",
    scripts: { dev: "node server.mjs" }
  }, null, 2));
  const serverSource = exitImmediately
    ? "process.exit(1);\n"
    : `import http from "node:http";\nconst server=http.createServer((req,res)=>{if(req.url==="/health"){res.writeHead(200);res.end("ok");return;}if(req.url==="/ok"){res.writeHead(${routeStatus});res.end();return;}res.writeHead(404);res.end();});\nserver.listen(${port},"127.0.0.1");\nfor (const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>server.close(()=>process.exit(0)));\n`;
  await writeFile(join(directory, "server.mjs"), serverSource);
  await writeFile(join(directory, ".atelier-routes.json"), JSON.stringify({ schema_version: 1, routes: [{ path: "/ok", status: expectedStatus }] }));
  await mkdir(join(directory, ".atelier"));
  await rename(join(directory, ".atelier-routes.json"), join(directory, ".atelier", "routes.json"));
  return { directory, port };
}

function contract(port) {
  return {
    schema_version: 1,
    profile: "NODE_WEB_VERIFY",
    node_version: "22.13.0",
    package_manager: "npm",
    scripts: { dev: "dev" },
    server: { health_url: `http://127.0.0.1:${port}/health`, startup_timeout_seconds: 5 },
    http_routes_file: ".atelier/routes.json"
  };
}

test("web contract rejects non-localhost health URL", () => {
  const value = contract(3000);
  value.server.health_url = "http://localhost:3000/health";
  assert.equal(validateWebContract(value).ok, false);
});

test("G5 serves declared route and cleans up", async () => {
  const { directory, port } = await makeTarget();
  try {
    const result = await executeWebHttpRuntime(directory, contract(port));
    assert.deepEqual(result, { ok: true, devServer: "PASS", http: "PASS", cleanup: "PASS" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP mismatch fails and confirms cleanup", async () => {
  const { directory, port } = await makeTarget({ routeStatus: 204, expectedStatus: 200 });
  try {
    const result = await executeWebHttpRuntime(directory, contract(port));
    assert.equal(result.ok, false);
    assert.equal(result.failureStage, "HTTP");
    assert.equal(result.cleanup, "PASS");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dev server early exit fails and confirms cleanup", async () => {
  const { directory, port } = await makeTarget({ exitImmediately: true });
  try {
    const result = await executeWebHttpRuntime(directory, contract(port));
    assert.equal(result.ok, false);
    assert.equal(result.failureStage, "DEV_SERVER");
    assert.equal(result.cleanup, "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

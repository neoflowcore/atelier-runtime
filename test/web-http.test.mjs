import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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

async function makeTarget({ routeStatus = 204, expectedStatus = 204 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "atelier-g5-"));
  const port = await freePort();
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "g5-fixture",
    private: true,
    type: "module",
    scripts: { dev: "node server.mjs" }
  }, null, 2));
  await writeFile(join(directory, "server.mjs"), `import http from "node:http";\nconst server=http.createServer((req,res)=>{if(req.url==="/health"){res.writeHead(200);res.end("ok");return;}if(req.url==="/ok"){res.writeHead(${routeStatus});res.end();return;}res.writeHead(404);res.end();});\nserver.listen(${port},"127.0.0.1");\nfor (const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>server.close(()=>process.exit(0)));\n`);
  await writeFile(join(directory, ".atelier-routes.json"), JSON.stringify({ schema_version: 1, routes: [{ path: "/ok", status: expectedStatus }] }));
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

async function moveRoutes(directory) {
  await writeFile(join(directory, ".atelier", "placeholder"), "", { flag: "wx" }).catch(() => {});
}

test("web contract rejects non-localhost health URL", () => {
  const value = contract(3000);
  value.server.health_url = "http://localhost:3000/health";
  assert.equal(validateWebContract(value).ok, false);
});

test("G5 serves declared route and cleans up", async () => {
  const { directory, port } = await makeTarget();
  try {
    const atelier = join(directory, ".atelier");
    await import("node:fs/promises").then(({ mkdir, rename }) => mkdir(atelier).then(() => rename(join(directory, ".atelier-routes.json"), join(atelier, "routes.json"))));
    const result = await executeWebHttpRuntime(directory, contract(port));
    assert.deepEqual(result, { ok: true, devServer: "PASS", http: "PASS", cleanup: "PASS" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP mismatch fails and still cleans up", async () => {
  const { directory, port } = await makeTarget({ routeStatus: 204, expectedStatus: 200 });
  try {
    const atelier = join(directory, ".atelier");
    await import("node:fs/promises").then(({ mkdir, rename }) => mkdir(atelier).then(() => rename(join(directory, ".atelier-routes.json"), join(atelier, "routes.json"))));
    const result = await executeWebHttpRuntime(directory, contract(port));
    assert.equal(result.ok, false);
    assert.equal(result.failureStage, "HTTP");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

-- D1 private metadata only. Never store DigitalOcean API keys or HTTP bearer secrets.
CREATE TABLE IF NOT EXISTS do_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS do_runs_updated_idx ON do_runs(updated_at_ms);
CREATE TABLE IF NOT EXISTS do_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS do_runs_ownership_tag_idx ON do_runs(json_extract(body_json, '$.lease.ownershipTag'));

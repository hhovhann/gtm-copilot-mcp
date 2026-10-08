import { serve } from "@hono/node-server";
import { openDb, resolveDbPath } from "./db/open.js";
import { loadConfigFile } from "./leads/config.js";
import { loadCompaniesFile, MockEnricher } from "./leads/enrich.js";
import { assertSecret } from "./webhook/auth.js";
import { createWebhookApp } from "./webhook/app.js";

function main() {
  const secret = assertSecret(process.env["WEBHOOK_SECRET"]);
  const host = process.env["HOST"] || "127.0.0.1";
  const port = Number(process.env["PORT"] || 3000);
  const dbPath = resolveDbPath();

  const app = createWebhookApp({
    db: openDb(dbPath),
    enricher: new MockEnricher(loadCompaniesFile(new URL("../data/companies.json", import.meta.url))),
    config: loadConfigFile(new URL("../config/routing.json", import.meta.url)),
    secret,
  });

  serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`gtm-copilot webhook listening on http://${info.address}:${info.port} (db: ${dbPath})`);
  });
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

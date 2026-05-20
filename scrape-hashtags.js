// scrape-hashtags.js — coleta posts ORGANICOS por HASHTAG de autocustodia no Instagram.
// Traz conteudo de custodia de qualquer creator (nao so do feed dos perfis), via Apify.

import { writeFile } from "node:fs/promises";

const HASHTAG_ACTOR = "apify~instagram-hashtag-scraper";
const RESULTS_PER_HASHTAG = 30;

const HASHTAGS = [
  "autocustodia",
  "autocustodiabitcoin",
  "carteirafria",
  "coldwallet",
  "hardwarewallet",
  "comoguardarbitcoin",
  "chaveprivada",
  "sejaseupropriobanco",
];

const TOKEN = process.env.APIFY_TOKEN;
const API = "https://api.apify.com/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apifyFetch(path, init) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}token=${TOKEN}`, init);
  if (!res.ok) throw new Error(`Apify ${res.status} em ${path}\n${(await res.text()).slice(0, 400)}`);
  return res.json();
}

async function runActor(actorId, input) {
  const start = await apifyFetch(`/acts/${actorId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const runId = start.data.id;
  const datasetId = start.data.defaultDatasetId;
  console.log(`   run ${runId}`);
  const TERMINAL = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
  let status = start.data.status, ticks = 0;
  while (!TERMINAL.includes(status)) {
    await sleep(5000);
    const run = await apifyFetch(`/actor-runs/${runId}`);
    status = run.data.status;
    process.stdout.write(`\r   status: ${status}  (${(++ticks) * 5}s)        `);
  }
  console.log("");
  if (status !== "SUCCEEDED") throw new Error(`run terminou: ${status}`);
  return apifyFetch(`/datasets/${datasetId}/items?clean=true`);
}

async function main() {
  if (!TOKEN) { console.error("\n❌ APIFY_TOKEN nao encontrado\n"); process.exit(1); }
  console.log("#️⃣ Hashtags:", HASHTAGS.join(", "));
  const items = await runActor(HASHTAG_ACTOR, {
    hashtags: HASHTAGS,
    resultsType: "posts",
    resultsLimit: RESULTS_PER_HASHTAG,
  });
  await writeFile("data/organic-hashtag-raw.json", JSON.stringify(items, null, 2), "utf8");
  console.log(`\n✅ ${items.length} posts salvos em data/organic-hashtag-raw.json`);
  if (items.length) console.log("🔑 Campos:", Object.keys(items[0]).join(", "));
}

main().catch((e) => { console.error("\n💥 Erro:", e.message); process.exit(1); });

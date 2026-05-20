// scrape-organic.js — Missão 2: minera conteudo ORGANICO dos creators de autocustodia.
// Roda o actor de Instagram (posts/reels por perfil) via Apify, salva o JSON bruto.
// Foco: extrair hooks (abertura das legendas) de quem fala de autocustodia organicamente.

import { writeFile } from "node:fs/promises";

const IG_ACTOR = "instagram-scraper~instagram-profile-posts-scraper";
const POSTS_PER_PROFILE = 18;

// Creators de autocustodia / bitcoin BR (organicos). r38tao=Trezoitao(38tao), elidiosegundo=Elidio.
const IG_HANDLES = [
  "r38tao",
  "elidiosegundo",
  "o.viniciusbazan",
  "mecanismocrypto",
  "declarandobitcoin",
  "gustavo.pirra",
  "jpgorni",
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
  if (!TOKEN) {
    console.error("\n❌ APIFY_TOKEN nao encontrado no .env\n");
    process.exit(1);
  }
  console.log("📸 Instagram — creators:", IG_HANDLES.join(", "));
  const items = await runActor(IG_ACTOR, {
    instagramUsernames: IG_HANDLES,
    postsPerProfile: POSTS_PER_PROFILE,
  });

  await writeFile("data/organic-ig-raw.json", JSON.stringify(items, null, 2), "utf8");
  console.log(`\n✅ ${items.length} posts salvos em data/organic-ig-raw.json`);
  if (items.length) {
    console.log("🔑 Campos do 1o registro:");
    console.log("   " + Object.keys(items[0]).join(", "));
  }
}

main().catch((e) => {
  console.error("\n💥 Erro:", e.message);
  process.exit(1);
});

// scrape.js — Etapa 1: minera a Biblioteca de Anuncios do Facebook via Apify.
// Roda o actor curious_coder/facebook-ads-library-scraper, busca ~100 anuncios
// ativos no sub-nicho de autocustodia (BR/PT) e salva tudo cru em data/ads-raw.json.

import { writeFile } from "node:fs/promises";

// ───────────────────────────── CONFIG ─────────────────────────────
const ACTOR_ID = "curious_coder~facebook-ads-library-scraper";
const TOTAL_ADS = 2000;

// MÁXIMO de autocustódia de bitcoin: (1) acervo completo das PÁGINAS das marcas de
// cold wallet (todos os países, via view_all_page_id) + (2) buscas por palavra-chave
// de autocustódia em vários países. O filtro em analyze.js mantém só o que é custódia.
const KEYWORDS_BR = [
  "autocustódia", "autocustodia", "auto custódia", "autocustodia bitcoin",
  "carteira fria", "cold wallet", "hardware wallet", "carteira de hardware",
  "como guardar bitcoin", "guardar bitcoin com segurança", "tirar bitcoin da corretora",
  "chave privada bitcoin", "seed phrase", "seja seu próprio banco",
  "segurança bitcoin", "carteira de bitcoin", "ledger", "trezor", "tangem", "coldcard",
];
const KEYWORDS_EN = [
  "self custody", "self-custody bitcoin", "cold wallet", "hardware wallet",
  "bitcoin cold storage", "store bitcoin safely", "not your keys", "secure bitcoin",
  "bitcoin security", "seed phrase backup", "ledger nano", "trezor", "tangem",
  "coldcard", "keystone wallet", "blockstream jade", "onekey", "bitbox",
];
const BRAND_KEYWORDS = ["hardware wallet", "cold wallet", "trezor", "tangem", "ellipal", "coldcard"];

// page_id das marcas (extraídos da coleta anterior) — pega TODO o acervo de ads.
const BRAND_PAGE_IDS = [
  "2066764506985289", // ELLIPAL
  "198891850249377",  // Trezor
  "1034327133376504", // Tangem
  "900847329781757",  // Blockstream Jade
  "244623749074003",  // Blockstream
  "101120022808339",  // Ryder
  "102519458909035",  // Blindado (BR)
  "426029763925333",  // D Security Lab (BR)
  "1088813740979751", // Guilherme Dsec Labs (BR)
];
// Marcas sem page_id conhecido — tenta pelo handle da página.
const BRAND_HANDLES = [
  "Ledger", "coldcard", "onekeyhq", "BitBoxSwiss", "foundationdevices", "SafePalOfficial",
];

// Países pra busca por palavra-chave em inglês (marcas anunciam global).
const EN_COUNTRIES = ["US", "GB", "CA", "AU"];

// ───────────────────────────── HELPERS ─────────────────────────────
const TOKEN = process.env.APIFY_TOKEN;
const API = "https://api.apify.com/v2";

function buildSearchUrl(keyword, mediaType = "all", country = "BR") {
  const q = encodeURIComponent(keyword);
  return (
    `https://www.facebook.com/ads/library/?active_status=all&ad_type=all` +
    `&country=${country}&q=${q}&search_type=keyword_unordered&media_type=${mediaType}`
  );
}
const buildPageIdUrl = (id) =>
  `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${id}`;
const buildHandleUrl = (h) => `https://www.facebook.com/${h}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apifyFetch(path, init) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}token=${TOKEN}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${res.status} em ${path}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

// ───────────────────────────── MAIN ─────────────────────────────
async function main() {
  if (!TOKEN) {
    console.error(
      "\n❌ APIFY_TOKEN nao encontrado.\n" +
        "   Cole seu token no arquivo .env e rode de novo com:  npm run scrape\n"
    );
    process.exit(1);
  }

  const urlSet = [];
  // 1) acervo completo das paginas das marcas (todos os paises)
  BRAND_PAGE_IDS.forEach((id) => urlSet.push(buildPageIdUrl(id)));
  BRAND_HANDLES.forEach((h) => urlSet.push(buildHandleUrl(h)));
  // 2) buscas BR (PT): video em todas + imagem nas marcas
  KEYWORDS_BR.forEach((kw) => urlSet.push(buildSearchUrl(kw, "video", "BR")));
  BRAND_KEYWORDS.forEach((kw) => urlSet.push(buildSearchUrl(kw, "all", "BR")));
  // 3) buscas EN em varios paises (video)
  EN_COUNTRIES.forEach((c) => KEYWORDS_EN.forEach((kw) => urlSet.push(buildSearchUrl(kw, "video", c))));

  const urls = [...new Set(urlSet)].map((url) => ({ url }));

  const input = {
    urls,
    count: TOTAL_ADS,
    scrapeAdDetails: false,
    "scrapePageAds.activeStatus": "all",
    "scrapePageAds.countryCode": "ALL",
    "scrapePageAds.sortBy": "impressions_desc",
  };

  console.log(`🏢 ${BRAND_PAGE_IDS.length} páginas de marca + ${BRAND_HANDLES.length} handles`);
  console.log(`🎬 ${urls.length} URLs no total (BR + ${EN_COUNTRIES.join("/")}) | alvo: ${TOTAL_ADS}\n`);

  // 1) Dispara o run
  console.log("🚀 Iniciando o actor na Apify...");
  const start = await apifyFetch(`/acts/${ACTOR_ID}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const runId = start.data.id;
  const datasetId = start.data.defaultDatasetId;
  console.log(`   run id: ${runId}`);

  // 2) Poll ate terminar
  const TERMINAL = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
  let status = start.data.status;
  let ticks = 0;
  while (!TERMINAL.includes(status)) {
    await sleep(5000);
    const run = await apifyFetch(`/actor-runs/${runId}`);
    status = run.data.status;
    const got = run.data.stats?.datasetItemCount ?? 0;
    process.stdout.write(
      `\r   ⏳ status: ${status}  | anuncios coletados: ${got}   (${++ticks * 5}s)   `
    );
  }
  console.log("");

  if (status !== "SUCCEEDED") {
    console.error(`\n❌ Run terminou com status: ${status}`);
    console.error(`   Veja os logs: https://console.apify.com/actors/runs/${runId}`);
    process.exit(1);
  }

  // 3) Baixa os itens do dataset
  console.log("📥 Baixando resultados...");
  const items = await apifyFetch(`/datasets/${datasetId}/items?clean=true`);

  // 4) Salva cru
  const outPath = "data/ads-raw.json";
  await writeFile(outPath, JSON.stringify(items, null, 2), "utf8");

  console.log(`\n✅ ${items.length} anuncios salvos em ${outPath}`);
  if (items.length) {
    console.log("\n🔑 Campos do primeiro registro (pra conferir o schema):");
    console.log("   " + Object.keys(items[0]).join(", "));
  } else {
    console.log(
      "\n⚠️  Nenhum anuncio retornado. O nicho pode estar muito estreito —" +
        " avise pra eu ampliar as palavras-chave."
    );
  }
}

main().catch((err) => {
  console.error("\n💥 Erro:", err.message);
  process.exit(1);
});

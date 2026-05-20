// analyze-organic.js — Missão 2: cura os posts organicos e extrai os HOOKS.
// Le data/organic-ig-raw.json, normaliza, filtra ruido (cortes de entretenimento),
// ranqueia por engajamento e separa os melhores hooks. Saidas: data/organic-curated.json
// + data/organic-digest.md (pra eu analisar o angulo de cada hook).

import { readFile, writeFile } from "node:fs/promises";

const TOP_N = 40;
const CAP_PER_CREATOR = 7; // diversidade: no maximo N hooks por creator

// FOCO: AUTOCUSTODIA DE BITCOIN. So entra hook que fala de custodia/cold wallet/chaves —
// nao trading, IR, dolarizacao, "o que e bitcoin" ou mindset financeiro generico.
const BRANDS = ["tangem", "ellipal", "blockstream", "ledger", "trezor",
  "coldcard", "keystone", "bitkey", "onekey", "safepal", "krux", "seedsigner", "ryder"];
const CUSTODY = [
  "autocust", "auto custód", "auto custod", "auto-custód", "auto-custod",
  "cold wallet", "carteira fria", "cold storage",
  "hardware wallet", "hardwallet", "carteira de hardware", "carteira offline", "wallet offline",
  "self-custody", "self custody", "seu próprio banco", "próprio banco",
  "not your keys", "chave privada", "chaves privadas", "private key",
  "seed phrase", "frase semente", "air-gap", "airgap",
  "guardar bitcoin", "guardar cripto", "guardar seus bitcoin", "armazenar bitcoin", "armazenar cripto",
  "tirar da corretora", "sair da corretora", "fora da corretora",
  "tirar bitcoin da corretora", "sair da exchange", "off-line",
  "#autocustodia", "#coldwallet", "#carteirafria", "#hardwarewallet",
];

function firstLine(caption = "") {
  const clean = caption.replace(/\r/g, "").trim();
  // pega a 1a frase/linha forte (ate quebra de linha ou pontuacao final)
  const line = clean.split(/\n|(?<=[.!?])\s/)[0].trim();
  return line.length > 4 ? line : clean.slice(0, 120);
}

// Normaliza os dois formatos: scraper de PERFIL e scraper de HASHTAG (campos diferentes).
function normalize(p) {
  const creator = p.ownerUsername || (p.owner && p.owner.username) || "?";
  const caption = (p.caption || "").trim();
  const sc = p.shortcode || p.shortCode;
  const isVideo = p.is_video ?? (p.type === "Video" || p.productType === "clips");
  return {
    id: p.id || p.pk || sc,
    creator,
    caption,
    hook: firstLine(caption),
    isVideo: !!isVideo,
    plays: p.play_count || p.view_count || p.videoPlayCount || p.videoViewCount || 0,
    likes: p.like_count || p.likesCount || 0,
    comments: p.comment_count || p.commentsCount || 0,
    date: p.taken_at || p.timestamp || null,
    url: p.url || (sc ? `https://www.instagram.com/p/${sc}/` : null),
    thumb: p.image || p.displayUrl || (p.images && p.images[0]) || null,
    hashtags: p.hashtags || [],
    isAd: !!p.is_ad || !!p.is_paid_partnership,
  };
}

// Mercado BR: descarta espanhol e idiomas nao-latinos (tailandes etc.).
const SPANISH = ["criptomonedas", "claves", "llaves", "dinero", "puedes",
  "frase semilla", "el efectivo", "tus ", " los ", " las ", " una ", "para ti",
  "fueraelfiat", "libertadeco", "es como una", "está expuest", "así de simple"];
const NON_LATIN = /[฀-๿Ѐ-ӿ一-鿿؀-ۿ]/; // thai/cirilico/cjk/arabe

function relevant(a) {
  if (NON_LATIN.test(a.caption)) return false;
  const hay = (a.caption + " " + (a.hashtags || []).join(" ")).toLowerCase();
  if (SPANISH.filter((t) => hay.includes(t)).length >= 2) return false;
  return CUSTODY.some((t) => hay.includes(t)) || BRANDS.some((t) => hay.includes(t));
}

const eng = (a) => a.plays + a.likes * 5; // engajamento ponderado (like vale mais)

async function readJsonSafe(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return []; }
}

async function main() {
  const profile = await readJsonSafe("data/organic-ig-raw.json");
  const hashtag = await readJsonSafe("data/organic-hashtag-raw.json");
  const raw = [...profile, ...hashtag].filter((p) => !p.error); // descarta registros de erro
  // dedup por id/url
  const seen = new Set();
  const norm = raw.map(normalize).filter((a) => {
    if (!a.id || !a.caption) return false;
    const k = a.id || a.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rel = norm.filter(relevant);
  console.log(`📂 ${raw.length} posts (perfil ${profile.length} + hashtag ${hashtag.length}) | ${rel.length} de autocustódia | ${norm.length - rel.length} fora do tema`);

  const sorted = rel.sort((a, b) => eng(b) - eng(a));
  // aplica teto por creator pra garantir diversidade na biblioteca de hooks
  const perCreator = {};
  const ranked = [];
  for (const a of sorted) {
    perCreator[a.creator] = (perCreator[a.creator] || 0) + 1;
    if (perCreator[a.creator] <= CAP_PER_CREATOR) ranked.push(a);
    if (ranked.length >= TOP_N) break;
  }

  await writeFile("data/organic-curated.json", JSON.stringify(ranked, null, 2), "utf8");

  const digest = ranked
    .map((a, i) => {
      return [
        `### ${i + 1}. @${a.creator} ${a.isVideo ? "🎬" : "🖼"}  ▶${a.plays} ♥${a.likes} 💬${a.comments}`,
        `id: ${a.id} | ${a.url || "-"}`,
        `HOOK: ${a.hook}`,
        `caption: ${a.caption.replace(/\s+/g, " ").slice(0, 320)}`,
      ].join("\n");
    })
    .join("\n\n");
  await writeFile("data/organic-digest.md", digest, "utf8");

  const byCreator = {};
  ranked.forEach((a) => (byCreator[a.creator] = (byCreator[a.creator] || 0) + 1));
  console.log("\n🏆 Top", ranked.length, "hooks por creator:");
  console.log(Object.entries(byCreator).map(([k, v]) => `  @${k}: ${v}`).join("\n"));
  console.log("\n✅ data/organic-curated.json + data/organic-digest.md");
}

main().catch((e) => { console.error("💥", e.message); process.exit(1); });

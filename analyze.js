// analyze.js — Etapa 2: curadoria dos anuncios validados.
// Le data/ads-raw.json, normaliza os dois formatos (imagem/video unico e carrossel),
// deduplica variacoes do mesmo criativo, calcula ha quantos dias cada anuncio roda e
// separa os 30 mais longevos (priorizando os que ainda estao ATIVOS = validados).
// Saidas: data/ads-curated.json (dados completos) e data/curated-digest.md (resumo p/ analise).

import { readFile, writeFile } from "node:fs/promises";

const TOP_N = 500; // mostra todo o acervo de autocustódia encontrado
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

// ─────────────────────── normalizacao ───────────────────────
function pickCreative(snap) {
  // anuncio simples
  const img =
    snap.images?.[0]?.original_image_url ||
    snap.images?.[0]?.resized_image_url ||
    null;
  const vid =
    snap.videos?.[0]?.video_hd_url || snap.videos?.[0]?.video_sd_url || null;
  const vidPreview = snap.videos?.[0]?.video_preview_image_url || null;

  // carrossel: junta os cards
  const cards = (snap.cards || []).map((c) => ({
    title: c.title || null,
    body: c.body || null,
    image: c.original_image_url || c.resized_image_url || null,
    video: c.video_hd_url || c.video_sd_url || null,
    videoPreview: c.video_preview_image_url || null,
    linkUrl: c.link_url || null,
  }));

  const firstCard = cards[0] || {};
  return {
    image: img || firstCard.image || null,
    video: vid || firstCard.video || null,
    videoPreview: vidPreview || firstCard.videoPreview || null,
    cards,
  };
}

function bodyText(snap) {
  const b = snap.body;
  const main = typeof b === "string" ? b : b?.text || "";
  if (main && main.trim()) return main.trim();
  // fallback: corpo do primeiro card
  return (snap.cards?.[0]?.body || "").trim();
}

function keywordFromUrl(url = "") {
  try {
    return decodeURIComponent(new URL(url).searchParams.get("q") || "");
  } catch {
    return "";
  }
}

function normalize(ad) {
  const snap = ad.snapshot || {};
  const creative = pickCreative(snap);
  const start = ad.start_date || null;
  const end = ad.is_active ? NOW : ad.end_date || NOW;
  const daysRunning = start ? Math.max(0, Math.floor((end - start) / DAY)) : 0;

  return {
    id: ad.ad_archive_id,
    collationId: ad.collation_id || null,
    collationCount: ad.collation_count || 1,
    pageName: ad.page_name || snap.page_name || "—",
    pageProfilePic: snap.page_profile_picture_url || null,
    pageLikes: snap.page_like_count ?? null,
    pageUrl: snap.page_profile_uri || null,
    isActive: !!ad.is_active,
    startDate: start,
    endDate: ad.end_date || null,
    startDateFormatted: ad.start_date_formatted || null,
    endDateFormatted: ad.end_date_formatted || null,
    daysRunning,
    platforms: ad.publisher_platform || [],
    displayFormat: snap.display_format || (creative.video ? "VIDEO" : "IMAGE"),
    title: snap.title || creative.cards[0]?.title || null,
    body: bodyText(snap),
    linkDescription: snap.link_description || null,
    caption: snap.caption || null,
    ctaText: snap.cta_text || creative.cards[0]?.title || null,
    ctaType: snap.cta_type || null,
    linkUrl: snap.link_url || creative.cards[0]?.linkUrl || null,
    image: creative.image,
    video: creative.video,
    videoPreview: creative.videoPreview,
    cards: creative.cards,
    isCarousel: creative.cards.length > 1,
    keyword: keywordFromUrl(ad.url),
    adLibraryUrl: ad.ad_library_url || null,
    categories: ad.categories || [],
  };
}

// ─────────────────────── relevancia (FOCO: AUTOCUSTODIA DE BITCOIN) ───────────────────────
// So entra quem fala de AUTOCUSTODIA — nao basta ser cripto. Trading, IR/imposto,
// dolarizacao, P2P, mineracao, "o que e bitcoin" e politica sao descartados.
// Marcas de cold wallet. "ledger/keystone/ryder" sao palavras comuns em ingles
// (livro-razao, NBA, caminhao Ryder...), entao so contam COM contexto de wallet.
// "tangem" sozinho saiu: é verbo em PT ("medidas que tangem o setor"). A marca Tangem
// entra pelo nome da página/link (PAGE_HINT) ou por menção com contexto de wallet.
const BRANDS = ["ellipal", "blockstream", "trezor",
  "coldcard", "bitkey", "onekey", "safepal", "krux", "seedsigner",
  "tangem wallet", "tangemwallet", "tangem.com", "tangem card", "tangem ring",
  "ledger nano", "ledger.com", "ledger stax", "ledger flex", "ledger live", "ledger wallet",
  "keystone wallet", "keystone3", "ryder one", "ryderone", "ryder.id"];
// Sinal de AUTOCUSTODIA (basta 1 pra qualificar).
const CUSTODY = [
  "autocust", "auto custód", "auto custod", "auto-custód", "auto-custod",
  "cold wallet", "carteira fria", "cold storage",
  "hardware wallet", "hardwallet", "carteira de hardware", "carteira offline", "wallet offline",
  "self-custody", "self custody", "seu próprio banco",
  "not your keys", "chave privada", "chaves privadas", "private key",
  "seed phrase", "frase semente", "air-gapped", "air-gap", "airgap",
  "guardar bitcoin", "guardar cripto", "guardar seus bitcoin", "armazenar bitcoin", "armazenar cripto",
  "tirar da corretora", "sair da corretora", "fora da corretora",
  "tirar bitcoin da corretora", "sair da exchange",
];
// Ruido DURO: drama/novela inequivoco. Derruba sempre.
const HARD_NOISE = ["lobisomem", "werewolf", "mafia", "godfather", "chapter",
  "capítulo", "ex-husband", "ex-wife", "one-ni", "pai alfa", "werecorp",
  "billionaire", "alpha male", " luna", "novela", "namorad",
  "drama", "episode", "academy's", "gospel",
  "renault", "voiture", "concept car", "norev"];
const SOFT_NOISE = ["romance", "iate", "leitura"];
// EXCLUSÃO DURA: golpe / phishing / off-topic. Derruba SEMPRE, mesmo com termo de cripto
// na isca (ex.: golpe de "recovery" usa "seed phrase" pra fisgar). Inclui impersonators
// de marca (falso suporte Ledger) e ruídos como iCloud.
const HARD_EXCLUDE = [
  "funds recov", "recovery expert", "crypto guardian", "recuperação de cripto",
  "recover your crypto", "lost access to your wallet", "wrong seed phrase", "tokens stuck",
  "ledger news", "ledger support", "official ledger support",
  "icloud",
];
// Off-topic: produto físico / religião / P2P. Só derruba quando o anúncio
// passou APENAS pela keyword/anunciante (sem sinal de marca/custódia no texto).
const OFFTOPIC = ["iphone", "phone case", "wallet case", " folio", "voiture", "renault",
  "concept car", "norev", "in christ", "riches in christ", "egrégora", "mammon",
  " p2p", " otc", "funds recovery", "recovery expert", "recuperação de cripto",
  "reelstv", "tell the truth",
  // couro / bolsas (casam com "wallet" mas nao sao cold wallet)
  "leather", "crossbody", "handbag", "purse", "bolsa", "tote", "couro", "review"];
const SPANISH = ["criptomonedas", "inversiones", "estafas", "dinero", "invertir",
  "clase gratuita", "aquí", "tus ", "cómo ", "comenta \"", "para que todos",
  "escribe", "puedes", "mejor estrategia", "asegurar tu", "el de tus", "futuro o el"];

// Muitos anúncios (ex.: a Vault) têm os campos de texto VAZIOS — a copy está dentro do
// vídeo/imagem. Pra esses, NÃO dá pra confiar na keyword (a busca unordered do FB pesca
// loja de roupa, bolsa, guru de renda...). Em vez disso exigimos sinal de cripto no
// ANUNCIANTE/LANDING (nome da página ou link): aí a Vault entra ("Cripto Brasil OFC" /
// "vaultcapital") e loja de roupa/bolsa/financiamento cai (não têm cripto no nome).
const PAGE_HINT = ["cripto", "criptomoed", "bitcoin", " btc", "satoshi", "blockchain",
  "autocust", "web3", "vaultcapital", "vault capital", "blockstream", "coldcard",
  "tangem", "ellipal", "onekey", "bitkey", "seedsigner", "trezor", "satsail"];

function relevance(a) {
  const hay = [a.pageName, a.title, a.body, a.linkDescription, a.caption]
    .filter(Boolean).join(" ").toLowerCase();
  const pageHay = [a.pageName, a.linkUrl, a.caption].filter(Boolean).join(" ").toLowerCase();
  const has = (list) => list.filter((t) => hay.includes(t));

  const brandHits = has(BRANDS);
  const custodyHits = has(CUSTODY);
  const hardNoise = has(HARD_NOISE);
  const softNoise = has(SOFT_NOISE);
  const esHits = has(SPANISH);
  const offtopic = has(OFFTOPIC);
  const hardExclude = has(HARD_EXCLUDE);
  const pageHint = PAGE_HINT.filter((t) => pageHay.includes(t));
  const textSignal = brandHits.length > 0 || custodyHits.length > 0;

  const isSpanish = esHits.length >= 2;
  const isHardNoise = hardNoise.length > 0;
  const isExcluded = hardExclude.length > 0; // golpe/phishing/off-topic: derruba sempre
  const isSoftNoise = softNoise.length > 0 && !textSignal && pageHint.length === 0;
  // off-topic so derruba se nao tem sinal forte de custodia no texto
  const isOfftopic = !textSignal && offtopic.length > 0;
  // Sinal: marca/custódia no texto OU anunciante/landing claramente de cripto.
  const hasCustody = textSignal || pageHint.length > 0;

  const qualifies = hasCustody && !isSpanish && !isHardNoise && !isExcluded && !isSoftNoise && !isOfftopic;
  const reasons = [];
  if (!hasCustody) reasons.push("não é sobre autocustódia");
  if (isExcluded) reasons.push(`golpe/off-topic: ${hardExclude.join("/")}`);
  if (isSpanish) reasons.push("idioma espanhol (mercado errado)");
  if (isHardNoise) reasons.push(`ruído (drama): ${hardNoise.join("/")}`);
  if (isSoftNoise) reasons.push(`ruído: ${softNoise.join("/")}`);
  if (isOfftopic) reasons.push(`off-topic: ${offtopic.join("/")}`);

  return {
    qualifies,
    viaPage: pageHint.length > 0 && !textSignal,
    score: brandHits.length * 5 + custodyHits.length * 4 + (pageHint.length > 0 ? 3 : 0) - (hardNoise.length + softNoise.length) * 6,
    reason: reasons.join("; ") || "ok",
  };
}

// So entra quem realmente "fala" de autocustodia: descarta copy vazia / placeholder
// de catalogo dinamico ({{product.brand}}), que nao tem mensagem pra modelar.
function hasRealCopy(a) {
  const txt = [a.title, a.body, a.linkDescription]
    .filter(Boolean).join(" ").replace(/\{\{[^}]*\}\}/g, "").trim();
  return txt.length >= 15;
}

// ─────────────────────── dedup ───────────────────────
function dedupKey(a) {
  if (a.collationId) return `c:${a.collationId}`;
  return `b:${a.pageName}::${(a.body || a.title || "").slice(0, 60)}`;
}

function dedup(ads) {
  const map = new Map();
  for (const a of ads) {
    const key = dedupKey(a);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...a, variations: 1 });
    } else {
      prev.variations += 1;
      prev.collationCount = Math.max(prev.collationCount, a.collationCount);
      // mantem o registro com maior longevidade como representante
      if (a.daysRunning > prev.daysRunning) {
        map.set(key, { ...a, variations: prev.variations, collationCount: prev.collationCount });
      }
    }
  }
  return [...map.values()];
}

// ─────────────────────── main ───────────────────────
async function main() {
  const raw = JSON.parse(await readFile("data/ads-raw.json", "utf8"));
  console.log(`📂 ${raw.length} anuncios brutos carregados.`);

  const normalized = raw
    .map(normalize)
    .filter((a) => a.id && (a.body || a.title || a.image || a.video)); // mantem criativo sem texto

  const unique = dedup(normalized);
  console.log(`🧹 ${unique.length} anuncios unicos apos dedup de variacoes.`);

  // Filtro de relevancia: so segue quem bate com o produto (autocustodia / cripto).
  // Descarta SO catalogo dinamico vazio ({{product}}). Video/imagem sem texto ficam
  // (a copy esta no criativo) — e justamente o caso dos anuncios da Vault.
  const isPlaceholderCatalog = (a) =>
    ["DCO", "DPA"].includes(a.displayFormat) && !hasRealCopy(a);

  // Empresas excluidas manualmente pelo usuario (botao no dashboard -> data/excluded.json).
  let excluded = [];
  try { excluded = JSON.parse(await readFile("data/excluded.json", "utf8")); } catch {}
  const exSet = new Set(excluded.map((s) => String(s).trim().toLowerCase()));
  const isExcludedCompany = (a) => exSet.has((a.pageName || "").trim().toLowerCase());

  const scored = unique.map((a) => ({ ...a, ...relevance(a) }));
  const relevant = scored.filter((a) => a.qualifies && !isPlaceholderCatalog(a) && !isExcludedCompany(a));
  if (exSet.size) console.log(`🚫 ${exSet.size} empresa(s) excluída(s) manualmente: ${[...exSet].join(", ")}`);
  const dropped = scored.filter((a) => !a.qualifies);
  console.log(`🎯 ${relevant.length} relevantes  |  🗑️  ${dropped.length} descartados por baixa relevancia.`);
  if (dropped.length) {
    console.log("   Descartados:");
    dropped.forEach((a) => console.log(`   - ${a.pageName.slice(0, 28).padEnd(28)} -> ${a.reason}`));
  }

  const activeCount = relevant.filter((a) => a.isActive).length;
  console.log(`\n🟢 ${activeCount} relevantes ainda ATIVOS  |  ⚪ ${relevant.length - activeCount} inativos.`);

  // Ordena: ativos primeiro, depois por dias rodando (longevidade) desc.
  const ranked = relevant.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.daysRunning - a.daysRunning;
  });

  const top = ranked.slice(0, TOP_N);
  console.log(`\n🏆 Top ${top.length} validados (ativos + mais longevos):`);

  await writeFile("data/ads-curated.json", JSON.stringify(top, null, 2), "utf8");

  // Digest compacto para a etapa de analise de IA.
  const digest = top
    .map((a, i) => {
      const status = a.isActive ? "ATIVO" : "inativo";
      return [
        `### ${i + 1}. [${a.id}] ${a.pageName}`,
        `- status: ${status} | dias rodando: ${a.daysRunning} | desde: ${a.startDateFormatted || "?"}`,
        `- formato: ${a.displayFormat}${a.isCarousel ? " (carrossel)" : ""} | variacoes: ${a.variations} | keyword: ${a.keyword}`,
        `- headline: ${a.title || "—"}`,
        `- cta: ${a.ctaText || "—"} -> ${a.linkUrl || "—"}`,
        `- copy: ${(a.body || "—").replace(/\s+/g, " ")}`,
        a.linkDescription ? `- desc: ${a.linkDescription.replace(/\s+/g, " ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  await writeFile("data/curated-digest.md", digest, "utf8");

  console.table(
    top.map((a, i) => ({
      "#": i + 1,
      page: a.pageName.slice(0, 22),
      status: a.isActive ? "ATIVO" : "inativo",
      dias: a.daysRunning,
      fmt: a.displayFormat,
    }))
  );

  console.log(`\n✅ Curadoria salva: data/ads-curated.json (${top.length}) + data/curated-digest.md`);
}

main().catch((e) => {
  console.error("💥 Erro:", e.message);
  process.exit(1);
});

// build-report.js — Etapa 3: gera o dashboard report.html (Dark Mode / SaaS),
// faz merge dos anuncios curados com os insights da IA, sobe um servidor local e abre no navegador.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { exec } from "node:child_process";

const PORT = process.env.PORT || 4321;
const BUILD_ONLY = process.argv.includes("--build"); // gera arquivos e sai (deploy), sem servidor

// ─────────────────────── merge ───────────────────────
const curated = JSON.parse(await readFile("data/ads-curated.json", "utf8"));
const insights = JSON.parse(await readFile("data/insights.json", "utf8"));

// Classificador automatico de angulo (fallback p/ ads sem insight manual).
// Como o acervo de autocustodia e grande, cada card recebe ao menos um angulo.
function autoClassify(a) {
  const t = [a.pageName, a.title, a.body, a.linkDescription].filter(Boolean).join(" ").toLowerCase();
  const tier = (s) => (s >= 80 ? "Alto" : s >= 50 ? "Médio" : "Baixo");
  let angle, score, triggers;
  if (/\{\{product/.test(t)) { angle = "Catálogo dinâmico (DCO)"; score = 76; triggers = ["Autoridade", "Escala"]; }
  else if (/not your keys|exchange|corretora|plataforma|platform fail|bloquei|congel|confisc|penhora|favor que|goes with them/.test(t)) { angle = "Medo de corretora / confisco"; score = 80; triggers = ["Medo", "Inimigo comum", "Segurança"]; }
  else if (/air-gap|airgap|offline|cold storage|tap to sign|nfc|open-source|firmware|clear sign|chip|secure element/.test(t)) { angle = "Produto: segurança técnica"; score = 76; triggers = ["Segurança", "Autoridade"]; }
  else if (/seed|backup|recovery|frase|aço|steel|passphrase|12 word|24 word|24 palavras/.test(t)) { angle = "Backup / proteção da seed"; score = 74; triggers = ["Segurança", "Quebra de objeção"]; }
  else if (/soberan|próprio banco|own bank|liberdade|inconfisc|sem banco|sem governo|sem intermedi|control/.test(t)) { angle = "Soberania / controle total"; score = 75; triggers = ["Soberania", "Aspiração"]; }
  else if (/afraid|medo|fácil|simple|easy|minuto|sem complica|qualquer um|não precisa|beginner|iniciante/.test(t)) { angle = "Quebra de objeção (facilidade)"; score = 73; triggers = ["Quebra de objeção", "Simplicidade"]; }
  else if (/% off|10% off|cupom|desconto|sale|limited|promo|meta10/.test(t)) { angle = "Oferta / desconto (cold wallet)"; score = 70; triggers = ["Escassez", "Conveniência"]; }
  else { angle = "Autocustódia (produto / educação)"; score = 68; triggers = ["Segurança", "Autoridade"]; }
  return { fitScore: score, fitTier: tier(score), angle, insight: `${a.pageName}: classificado automaticamente como "${angle}". Anúncio de autocustódia coletado do acervo — abra o original pra ver a copy completa.`, triggers, auto: true };
}

const strip = (s) => (s || "").replace(/\{\{[^}]*\}\}/g, "").replace(/\s{2,}/g, " ").trim();

// Detecta idioma do anuncio (pt | en | ?). So organiza — nao remove nada.
const EN_BRANDS = ["trezor", "ledger", "tangem", "ellipal", "onekey", "blockstream",
  "ryder", "coldcard", "bitkey", "keystone", "safepal", "seedsigner"];
function detectLang(a) {
  const txt = [a.title, a.body, a.linkDescription, a.caption]
    .filter(Boolean).join(" ").replace(/\{\{[^}]*\}\}/g, "").toLowerCase();
  const url = (a.linkUrl || "").toLowerCase();
  const page = (a.pageName || "").toLowerCase();
  if (txt.trim().length < 8) {
    // sem texto raspável: usa dominio / marca
    if (/\.br\b|\.com\.br/.test(url + " " + (a.caption || "").toLowerCase())) return "pt";
    if (EN_BRANDS.some((b) => page.includes(b))) return "en";
    return "?";
  }
  const pt = (txt.match(/[ãõáéíóúâêôçà]/g) || []).length +
    (txt.match(/\b(você|voce|seu|sua|não|nao|para|com|que|guardar|carteira|dinheiro|segurança|seguranca|próprio|proprio|banco|chave|corretora|aprenda|grátis|gratis|sem|mais|você)\b/g) || []).length;
  const en = (txt.match(/\b(your|you|the|with|and|for|wallet|crypto|secure|self|keys|cold|hardware|own|store|backup|now|free|get|how|don't|that|this|are|is)\b/g) || []).length;
  if (pt === 0 && en === 0) return "?";
  return pt >= en ? "pt" : "en";
}

const ads = curated.map((a, i) => {
  const clean = { ...a, title: strip(a.title), body: strip(a.body), linkDescription: strip(a.linkDescription) };
  return { rank: i + 1, ...clean, lang: detectLang(a), ai: insights[a.id] || autoClassify(clean) };
});

// estatisticas pro cabecalho
const activeCount = ads.filter((a) => a.isActive).length;
const maxDays = Math.max(...ads.map((a) => a.daysRunning));
const scores = ads.map((a) => a.ai.fitScore).filter((s) => typeof s === "number");
const avgFit = Math.round(scores.reduce((s, n) => s + n, 0) / (scores.length || 1));
const topAdvertiser = [...ads].sort((a, b) => b.daysRunning - a.daysRunning)[0]?.pageName || "—";
const ptCount = ads.filter((a) => a.lang === "pt").length;
const enCount = ads.filter((a) => a.lang === "en").length;

const stats = { total: ads.length, activeCount, maxDays, avgFit, topAdvertiser, ptCount, enCount };
const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });

const payload = JSON.stringify({ ads, stats }).replace(/</g, "\\u003c");

// ─────────────────────── HTML ───────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="referrer" content="no-referrer" />
<title>Vault Capital · Inteligência Competitiva de Anúncios</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<script>
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: { sans: ['Inter','system-ui','sans-serif'], mono: ['JetBrains Mono','monospace'] },
        colors: { ink: '#07080c', panel: '#0e1018' },
      }
    }
  }
</script>
<style>
  html { scroll-behavior: smooth; }
  body { background: radial-gradient(1200px 600px at 80% -10%, rgba(16,185,129,.10), transparent 60%),
                     radial-gradient(1000px 500px at 0% 0%, rgba(56,189,248,.10), transparent 55%),
                     #07080c; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #1f2430; border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: #2b3242; }
  .glass { background: rgba(255,255,255,.025); backdrop-filter: blur(10px); }
  .card { transition: transform .25s cubic-bezier(.2,.7,.2,1), box-shadow .25s, border-color .25s; }
  .card:hover { transform: translateY(-4px); border-color: rgba(16,185,129,.35); box-shadow: 0 20px 50px -20px rgba(16,185,129,.25); }
  .clamp { display:-webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .clamp.open { -webkit-line-clamp: unset; }
  .fade-in { animation: fade .5s ease both; }
  @keyframes fade { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
  .chip-active::before { content:''; width:7px; height:7px; border-radius:99px; background:#34d399; box-shadow:0 0 10px #34d399; display:inline-block; margin-right:6px; animation: pulse 1.6s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
</style>
</head>
<body class="font-sans text-slate-200 antialiased min-h-screen">

  <div class="max-w-[1400px] mx-auto px-5 sm:px-8 py-10">

    <!-- HEADER -->
    <header class="mb-8">
      <div class="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-emerald-400/90 border border-emerald-400/20 bg-emerald-400/5 rounded-full px-3 py-1 mb-4">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Vault Capital · Ad Intelligence Engine
      </div>
      <h1 class="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.05]">
        Anúncios <span class="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Validados</span> do seu Nicho
      </h1>
      <p class="mt-3 text-slate-400 max-w-2xl">
        Mineração da Biblioteca de Anúncios do Facebook (BR) · curadoria dos mais longevos · análise de <span class="text-slate-200 font-medium">fit</span> e ângulo de venda contra a <span class="text-slate-200 font-medium">Imersão em Autocustódia</span>.
      </p>
      <p class="mt-2 text-xs text-slate-500 font-mono">Gerado em ${generatedAt}</p>

      <!-- STATS -->
      <div class="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-7" id="stats"></div>
    </header>

    <!-- CONTROLS -->
    <div class="glass border border-white/10 rounded-2xl p-3 sm:p-4 mb-7 flex flex-col gap-3 sticky top-3 z-20">
      <div class="flex flex-wrap items-center gap-2" id="views"></div>
      <div id="adcontrols" class="flex flex-col gap-3">
        <div class="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div class="flex flex-wrap gap-2 items-center" id="filters"></div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-slate-500 mr-1">Ordenar:</span>
            <div class="flex gap-2" id="sorts"></div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span class="text-xs text-slate-500 mr-1">Idioma:</span>
          <div class="flex flex-wrap gap-2" id="langs"></div>
        </div>
      </div>
    </div>

    <!-- GRID -->
    <main id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"></main>

    <footer class="mt-12 text-center text-xs text-slate-600">
      <p>As mídias (foto/vídeo) vêm direto dos servidores do Facebook e têm links com validade — se expirarem, rode o scraper de novo.</p>
      <p class="mt-1">Dados brutos preservados em <span class="font-mono text-slate-500">data/ads-raw.json</span> · Engine por Vault Capital</p>
    </footer>
  </div>

<script id="data" type="application/json">${payload}</script>
<script>
  const { ads, stats } = JSON.parse(document.getElementById('data').textContent);

  const tierColor = (s) => s >= 80 ? 'emerald' : s >= 50 ? 'amber' : 'rose';
  const esc = (t) => (t ?? '').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const domain = (u) => { try { return new URL(u).hostname.replace('www.',''); } catch { return u || ''; } };

  // STATS
  const statItems = [
    { label: 'Anúncios analisados', value: stats.total, sub: 'top longevos' },
    { label: 'Ativos agora', value: stats.activeCount, sub: 'rodando hoje', accent: true },
    { label: 'Idiomas', value: stats.ptCount + ' PT · ' + stats.enCount + ' EN', sub: 'separáveis no filtro', small: true },
    { label: 'Maior longevidade', value: stats.maxDays + 'd', sub: 'dias no ar' },
    { label: 'Fit médio', value: stats.avgFit, sub: '/ 100' },
    { label: 'Mais longevo', value: stats.topAdvertiser, sub: 'anunciante', small: true },
  ];
  document.getElementById('stats').innerHTML = statItems.map(s => \`
    <div class="glass border border-white/10 rounded-xl p-4">
      <div class="text-[11px] uppercase tracking-wider text-slate-500">\${s.label}</div>
      <div class="mt-1 font-extrabold text-white \${s.small ? 'text-lg leading-tight' : 'text-3xl'} \${s.accent ? 'text-emerald-400' : ''}">\${esc(s.value)}</div>
      <div class="text-[11px] text-slate-500 mt-0.5">\${s.sub}</div>
    </div>\`).join('');

  // MEDIA
  function media(a) {
    const fmtBadge = \`<span class="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide bg-black/70 text-white px-2 py-1 rounded-md backdrop-blur">\${esc(a.displayFormat)}\${a.isCarousel ? ' · carrossel' : ''}</span>\`;
    const kwBadge = a.keyword ? \`<span class="absolute top-2 right-2 text-[10px] font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-400/20 px-2 py-1 rounded-md backdrop-blur">\${esc(a.keyword)}</span>\` : '';
    let inner;
    if (a.video) {
      inner = \`<video class="w-full h-full object-cover" controls preload="none" playsinline \${a.videoPreview ? \`poster="\${esc(a.videoPreview)}"\` : ''} referrerpolicy="no-referrer">
        <source src="\${esc(a.video)}" type="video/mp4"></video>\`;
    } else if (a.image || a.videoPreview) {
      inner = \`<img src="\${esc(a.image || a.videoPreview)}" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover"
        onerror="this.parentElement.classList.add('media-fail');this.remove();" alt="criativo">\`;
    } else {
      inner = '';
    }
    return \`<div class="relative aspect-[4/3] bg-gradient-to-br from-slate-800/40 to-slate-900/40 overflow-hidden group">
      \${inner}
      <div class="media-ph absolute inset-0 hidden items-center justify-center text-slate-600 text-sm">sem criativo</div>
      \${fmtBadge}\${kwBadge}
    </div>\`;
  }

  function card(a) {
    const ai = a.ai;
    const c = ai.fitScore == null ? 'slate' : tierColor(ai.fitScore);
    const initials = (a.pageName || '?').slice(0,2).toUpperCase();
    const avatar = a.pageProfilePic
      ? \`<img src="\${esc(a.pageProfilePic)}" referrerpolicy="no-referrer" class="w-10 h-10 rounded-full object-cover ring-2 ring-white/10" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'w-10 h-10 rounded-full bg-slate-700 grid place-items-center text-xs font-bold text-slate-300',textContent:'\${initials}'}))">\`
      : \`<div class="w-10 h-10 rounded-full bg-slate-700 grid place-items-center text-xs font-bold text-slate-300">\${initials}</div>\`;

    const triggers = (ai.triggers || []).map(t =>
      \`<span class="text-[10px] font-medium bg-white/5 border border-white/10 text-slate-300 px-2 py-0.5 rounded-full">\${esc(t)}</span>\`).join('');

    const statusBadge = a.isActive
      ? \`<span class="chip-active text-[11px] font-semibold text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 px-2 py-1 rounded-full flex items-center">Ativo</span>\`
      : \`<span class="text-[11px] font-medium text-slate-400 bg-white/5 border border-white/10 px-2 py-1 rounded-full">Inativo</span>\`;

    const headline = a.title && a.title.trim() && a.title !== a.pageName
      ? \`<p class="text-sm font-semibold text-white mb-1.5">\${esc(a.title)}</p>\` : '';

    const body = a.body && a.body.trim()
      ? \`<p class="clamp text-sm text-slate-300 leading-relaxed cursor-pointer" onclick="this.classList.toggle('open')">\${esc(a.body)}</p>\`
      : \`<p class="text-sm text-slate-500 italic">(sem texto de copy — criativo só visual)</p>\`;

    const cta = (a.ctaText || a.linkUrl)
      ? \`<a href="\${esc(a.linkUrl||'#')}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200">
           <span class="bg-cyan-500/15 border border-cyan-400/20 rounded-md px-2 py-1">\${esc(a.ctaText||'Link')}</span>
           <span class="text-slate-500 truncate max-w-[160px]">\${esc(domain(a.linkUrl))}</span></a>\`
      : '';

    return \`<article class="card fade-in glass border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        data-active="\${a.isActive}" data-fit="\${ai.fitScore ?? 0}" data-days="\${a.daysRunning}" data-rank="\${a.rank}">
      <!-- advertiser -->
      <div class="flex items-center gap-3 p-4 pb-3">
        \${avatar}
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="font-semibold text-white text-sm truncate">\${esc(a.pageName)}</p>
            <span title="\${a.lang==='pt'?'Português':a.lang==='en'?'English':'Indefinido'}">\${a.lang==='pt'?'🇧🇷':a.lang==='en'?'🇺🇸':'🌐'}</span>
            <span class="text-[10px] font-mono text-slate-600">#\${a.rank}</span>
          </div>
          <p class="text-[11px] text-slate-500">\${a.pageLikes != null ? a.pageLikes.toLocaleString('pt-BR')+' curtidas · ' : ''}\${a.startDateFormatted ? 'desde '+a.startDateFormatted.slice(0,10) : ''}</p>
        </div>
        \${statusBadge}
      </div>

      \${media(a)}

      <!-- copy -->
      <div class="p-4 flex-1 flex flex-col gap-3">
        <div class="flex items-center gap-2 text-[11px] text-slate-400">
          <span class="font-mono font-bold text-slate-200">\${a.daysRunning}d</span> no ar
          <span class="text-slate-700">•</span>
          <span>\${(a.platforms||[]).slice(0,3).map(esc).join(' · ') || '—'}</span>
        </div>
        <div>\${headline}\${body}</div>
        \${cta}

        <!-- AI INSIGHT -->
        <div class="mt-auto rounded-xl border border-\${c}-400/25 bg-gradient-to-br from-\${c}-500/10 to-transparent p-3.5">
          <div class="flex items-center justify-between mb-2">
            <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-\${c}-300">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>
              \${ai.auto ? 'Ângulo (auto)' : 'Insight da IA'}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-medium text-\${c}-300/80">\${esc(ai.fitTier)}</span>
              <span class="text-sm font-extrabold text-\${c}-300 font-mono">\${ai.fitScore ?? '—'}<span class="text-[10px] text-slate-500">/100</span></span>
            </div>
          </div>
          <p class="text-xs font-semibold text-white mb-1">\${esc(ai.angle)}</p>
          <p class="text-xs text-slate-300 leading-relaxed mb-2.5">\${esc(ai.insight)}</p>
          <div class="flex flex-wrap gap-1.5">\${triggers}</div>
        </div>

        \${a.adLibraryUrl ? \`<a href="\${esc(a.adLibraryUrl)}" target="_blank" rel="noopener" class="text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1">Ver na Biblioteca de Anúncios ↗</a>\` : ''}
      </div>
    </article>\`;
  }

  // ===== agregação por EMPRESA (anunciante) =====
  const companies = Object.values(ads.reduce((m, a) => {
    const k = a.pageName || '—';
    const c = m[k] || (m[k] = { name: k, pic: a.pageProfilePic, count: 0, active: 0, fitSum: 0, fitN: 0, maxDays: 0, pt: 0, en: 0, video: 0 });
    c.count++;
    if (a.isActive) c.active++;
    if (typeof a.ai.fitScore === 'number') { c.fitSum += a.ai.fitScore; c.fitN++; }
    c.maxDays = Math.max(c.maxDays, a.daysRunning || 0);
    if (a.lang === 'pt') c.pt++; else if (a.lang === 'en') c.en++;
    if (a.video || /VIDEO/.test(a.displayFormat || '')) c.video++;
    if (!c.pic && a.pageProfilePic) c.pic = a.pageProfilePic;
    return m;
  }, {}));
  companies.forEach(c => { c.avgFit = c.fitN ? Math.round(c.fitSum / c.fitN) : 0; });

  function companyCard(c) {
    const initials = (c.name || '?').slice(0, 2).toUpperCase();
    const avatar = c.pic
      ? \`<img src="\${esc(c.pic)}" referrerpolicy="no-referrer" class="w-11 h-11 rounded-full object-cover ring-2 ring-white/10" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'w-11 h-11 rounded-full bg-slate-700 grid place-items-center text-xs font-bold text-slate-300',textContent:'\${initials}'}))">\`
      : \`<div class="w-11 h-11 rounded-full bg-slate-700 grid place-items-center text-xs font-bold text-slate-300">\${initials}</div>\`;
    const flags = ((c.pt ? '🇧🇷' : '') + (c.en ? '🇺🇸' : '')) || '🌐';
    return \`<article class="card fade-in glass border border-white/10 rounded-2xl p-5 flex flex-col gap-4 cursor-pointer" data-company="\${esc(c.name)}">
      <div class="flex items-center gap-3">
        \${avatar}
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-white truncate">\${esc(c.name)}</p>
          <p class="text-[11px] text-slate-500">\${flags} · \${c.video} em vídeo</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div><div class="text-2xl font-extrabold text-white">\${c.count}</div><div class="text-[10px] text-slate-500 uppercase tracking-wide">anúncios</div></div>
        <div><div class="text-2xl font-extrabold \${c.active ? 'text-emerald-400' : 'text-slate-500'}">\${c.active}</div><div class="text-[10px] text-slate-500 uppercase tracking-wide">ativos</div></div>
        <div><div class="text-2xl font-extrabold text-cyan-300">\${c.avgFit}</div><div class="text-[10px] text-slate-500 uppercase tracking-wide">fit méd</div></div>
      </div>
      <div class="flex items-center justify-between text-[11px] text-slate-500">
        <span>mais longevo: <span class="font-mono text-slate-300">\${c.maxDays}d</span></span>
        <span class="text-emerald-300 font-semibold">Ver anúncios →</span>
      </div>
    </article>\`;
  }

  // STATE + RENDER
  let state = { view: 'ads', company: null, filter: 'all', lang: 'all', sort: 'rank' };
  const grid = document.getElementById('grid');

  function apply() {
    document.getElementById('adcontrols').style.display = state.view === 'companies' ? 'none' : 'flex';
    if (state.view === 'companies') {
      const list = companies.slice().sort((a, b) => b.count - a.count || b.avgFit - a.avgFit);
      grid.innerHTML = list.map(companyCard).join('');
      document.querySelectorAll('#grid [data-company]').forEach(el => el.onclick = () => {
        state.company = el.dataset.company; state.view = 'ads'; paintControls(); apply(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      return;
    }
    let list = ads.slice();
    if (state.company) list = list.filter(a => a.pageName === state.company);
    if (state.lang !== 'all') list = list.filter(a => (a.lang||'?') === state.lang);
    if (state.filter === 'active') list = list.filter(a => a.isActive);
    if (state.filter === 'high') list = list.filter(a => (a.ai.fitScore||0) >= 80);
    if (state.filter === 'video') list = list.filter(a => a.video || /VIDEO/.test(a.displayFormat||''));
    if (state.filter === 'image') list = list.filter(a => !a.video && !/VIDEO/.test(a.displayFormat||''));
    const sorters = {
      rank: (a,b) => a.rank - b.rank,
      fit: (a,b) => (b.ai.fitScore||0) - (a.ai.fitScore||0),
      days: (a,b) => b.daysRunning - a.daysRunning,
    };
    list.sort(sorters[state.sort]);
    grid.innerHTML = list.map(card).join('') || '<p class="text-slate-500 col-span-full text-center py-20">Nenhum anúncio neste filtro.</p>';
  }

  // CONTROLS
  const filters = [
    { id:'all', label:'Todos' }, { id:'active', label:'Só ativos' },
    { id:'video', label:'🎬 Só vídeos' }, { id:'image', label:'Só imagem' },
    { id:'high', label:'Fit alto (80+)' },
  ];
  const sorts = [
    { id:'rank', label:'Curadoria' }, { id:'fit', label:'Maior fit' }, { id:'days', label:'Mais longevos' },
  ];
  const langs = [
    { id:'all', label:'Todos ('+ads.length+')' },
    { id:'pt', label:'🇧🇷 Português ('+stats.ptCount+')' },
    { id:'en', label:'🇺🇸 English ('+stats.enCount+')' },
    { id:'?', label:'Outro ('+(ads.length-stats.ptCount-stats.enCount)+')' },
  ];
  function btn(item, active) {
    return \`<button data-id="\${item.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition \${active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'}">\${item.label}</button>\`;
  }
  function vbtn(view, label, active) {
    return \`<button data-view="\${view}" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition \${active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'}">\${label}</button>\`;
  }
  function paintControls() {
    let v = vbtn('ads', '📋 Por anúncio', state.view === 'ads' && !state.company)
          + vbtn('companies', '🏢 Por empresa (' + companies.length + ')', state.view === 'companies');
    if (state.company) v += \`<button id="clearcompany" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">\${esc(state.company)} ✕</button>\`;
    document.getElementById('views').innerHTML = v;
    document.getElementById('filters').innerHTML = filters.map(f => btn(f, state.filter===f.id)).join('');
    document.getElementById('sorts').innerHTML = sorts.map(s => btn(s, state.sort===s.id)).join('');
    document.getElementById('langs').innerHTML = langs.map(l => btn(l, state.lang===l.id)).join('');
    document.querySelectorAll('#views button[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; if (b.dataset.view === 'ads') state.company = null; paintControls(); apply(); });
    const cc = document.getElementById('clearcompany'); if (cc) cc.onclick = () => { state.company = null; paintControls(); apply(); };
    document.querySelectorAll('#filters button').forEach(b => b.onclick = () => { state.filter = b.dataset.id; paintControls(); apply(); });
    document.querySelectorAll('#sorts button').forEach(b => b.onclick = () => { state.sort = b.dataset.id; paintControls(); apply(); });
    document.querySelectorAll('#langs button').forEach(b => b.onclick = () => { state.lang = b.dataset.id; paintControls(); apply(); });
  }

  paintControls();
  apply();
</script>
</body>
</html>`;

await writeFile("report.html", html, "utf8");
// docs/index.html = a versao pro GitHub Pages (mesmo conteudo, só os anúncios).
await mkdir("docs", { recursive: true });
await writeFile("docs/index.html", html, "utf8");
console.log(`✅ report.html + docs/index.html gerados (${ads.length} cards).`);

if (BUILD_ONLY) process.exit(0); // modo deploy: só gera os arquivos

// ─────────────────────── servidor + abrir ───────────────────────
const server = createServer(async (req, res) => {
  try {
    const file = req.url === "/" || req.url.startsWith("/?") ? "report.html" : req.url.slice(1);
    const data = await readFile(file);
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".json") ? "application/json" : "text/plain";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`🌐 Servindo em ${url}  (Ctrl+C pra parar)`);
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
});

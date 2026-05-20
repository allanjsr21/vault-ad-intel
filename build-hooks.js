// build-hooks.js — Missão 2: gera o hooks.html (Dark/SaaS) com os melhores hooks
// organicos dos creators de autocustodia. Merge curados + insights, serve em localhost:4322.

import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { exec } from "node:child_process";

const PORT = process.env.PORT || 4322;

const curated = JSON.parse(await readFile("data/organic-curated.json", "utf8"));
const insights = JSON.parse(await readFile("data/organic-insights.json", "utf8"));

// Categoria canonica (pro filtro) derivada do hookType descritivo de cada insight.
function categorize(t = "") {
  const s = t.toLowerCase();
  if (/comando|cta|coment/.test(s)) return "Comando / comentário";
  if (/produto|oferta|lançamento|acessório|specs|aspiracional|parceria|evento/.test(s)) return "Produto / oferta";
  if (/humor/.test(s)) return "Humor";
  if (/antítese|antes\/depois|frase de efeito|reframe|imperativo/.test(s)) return "Reframe / antítese";
  if (/medo|urgência|urgencia|alerta|ameaça|newsjack|notícia|pânico|contra-pânico/.test(s)) return "Medo / urgência";
  if (/curiosidade|open loop|mistério|revelação|storytelling|depoimento/.test(s)) return "Curiosidade / storytelling";
  if (/dado|contrarian|chocante/.test(s)) return "Dado / contrarian";
  if (/procrast|execução|execucao/.test(s)) return "Anti-procrastinação";
  if (/objeção|anti-hype|facilidade/.test(s)) return "Quebra de objeção";
  if (/lista|checklist|utilidade|curadoria/.test(s)) return "Lista / utilidade";
  if (/pergunta|qualificação|reframe/.test(s)) return "Pergunta / reframe";
  if (/educação|explicador|análise|macro|tese/.test(s)) return "Educação";
  return "Outros";
}

const hooks = curated.map((a, i) => {
  const ai = insights[a.id] || { hookScore: null, hookType: "—", insight: "", adapt: "" };
  return { rank: i + 1, ...a, ai, cat: categorize(ai.hookType) };
});

const creators = [...new Set(hooks.map((h) => h.creator))];
const totalPlays = hooks.reduce((s, h) => s + (h.plays || 0), 0);
const totalLikes = hooks.reduce((s, h) => s + (h.likes || 0), 0);
const topType = (() => {
  const t = {};
  hooks.forEach((h) => (t[h.cat] = (t[h.cat] || 0) + 1));
  return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
})();

const stats = {
  total: hooks.length,
  creators: creators.length,
  plays: totalPlays,
  likes: totalLikes,
  topType,
};
const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
const payload = JSON.stringify({ hooks, stats }).replace(/</g, "\\u003c");

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="referrer" content="no-referrer" />
<title>Vault Capital · Biblioteca de Hooks Orgânicos</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<style>
  html { scroll-behavior: smooth; }
  body { background: radial-gradient(1200px 600px at 80% -10%, rgba(168,85,247,.12), transparent 60%),
                     radial-gradient(1000px 500px at 0% 0%, rgba(56,189,248,.10), transparent 55%), #07080c;
         font-family: Inter, system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 10px; } ::-webkit-scrollbar-thumb { background:#1f2430; border-radius:99px; }
  .glass { background: rgba(255,255,255,.025); backdrop-filter: blur(10px); }
  .card { transition: transform .25s, box-shadow .25s, border-color .25s; }
  .card:hover { transform: translateY(-4px); border-color: rgba(168,85,247,.4); box-shadow: 0 20px 50px -20px rgba(168,85,247,.3); }
  .fade-in { animation: fade .5s ease both; } @keyframes fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
</style>
</head>
<body class="text-slate-200 antialiased min-h-screen">
  <div class="max-w-[1400px] mx-auto px-5 sm:px-8 py-10">
    <header class="mb-8">
      <div class="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-fuchsia-400/90 border border-fuchsia-400/20 bg-fuchsia-400/5 rounded-full px-3 py-1 mb-4">
        <span class="w-1.5 h-1.5 rounded-full bg-fuchsia-400"></span> Vault Capital · Hook Intelligence
      </div>
      <h1 class="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.05]">
        Biblioteca de <span class="bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">Hooks Orgânicos</span>
      </h1>
      <p class="mt-3 text-slate-400 max-w-2xl">Os ganchos de maior engajamento dos creators brasileiros de autocustódia (Instagram). Cada card mostra o hook, o tipo, por que funciona e como adaptar pra Vault.</p>
      <p class="mt-2 text-xs text-slate-500 font-mono">Gerado em ${generatedAt}</p>
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-7" id="stats"></div>
    </header>

    <div class="glass border border-white/10 rounded-2xl p-3 sm:p-4 mb-7 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between sticky top-3 z-20">
      <div class="flex flex-wrap gap-2" id="filters"></div>
      <div class="flex flex-wrap items-center gap-2"><span class="text-xs text-slate-500 mr-1">Ordenar:</span><div class="flex gap-2" id="sorts"></div></div>
    </div>

    <main id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"></main>
    <footer class="mt-12 text-center text-xs text-slate-600">
      <p>Hooks extraídos da 1ª linha das legendas (em vídeo, o hook falado nos 3s iniciais pode diferir). Dados brutos em <span class="font-mono">data/organic-ig-raw.json</span>.</p>
    </footer>
  </div>

<script id="data" type="application/json">${payload}</script>
<script>
  const { hooks, stats } = JSON.parse(document.getElementById('data').textContent);
  const esc = (t) => (t ?? '').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtN = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : (n||0);
  const sc = (s) => s >= 80 ? 'emerald' : s >= 60 ? 'amber' : 'slate';

  document.getElementById('stats').innerHTML = [
    {l:'Hooks',v:stats.total,s:'curados'},
    {l:'Creators',v:stats.creators,s:'autocustódia BR'},
    {l:'Views somadas',v:fmtN(stats.plays),s:'alcance total',a:true},
    {l:'Likes somados',v:fmtN(stats.likes),s:'engajamento'},
    {l:'Tipo dominante',v:stats.topType,s:'gancho mais usado',sm:true},
  ].map(s => \`<div class="glass border border-white/10 rounded-xl p-4">
      <div class="text-[11px] uppercase tracking-wider text-slate-500">\${s.l}</div>
      <div class="mt-1 font-extrabold text-white \${s.sm?'text-sm leading-tight':'text-3xl'} \${s.a?'text-fuchsia-400':''}">\${esc(s.v)}</div>
      <div class="text-[11px] text-slate-500 mt-0.5">\${s.s}</div></div>\`).join('');

  function card(h) {
    const ai = h.ai; const c = sc(ai.hookScore||0);
    const initials = (h.creator||'?').slice(0,2).toUpperCase();
    const thumb = h.thumb ? \`<img src="\${esc(h.thumb)}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-40 object-cover" onerror="this.style.display='none'">\` : '';
    return \`<article class="card fade-in glass border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        data-cat="\${esc(h.cat)}" data-score="\${ai.hookScore||0}" data-eng="\${h.plays + h.likes*5}" data-rank="\${h.rank}">
      <div class="flex items-center gap-3 p-4 pb-2">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-fuchsia-500/40 to-cyan-500/40 grid place-items-center text-xs font-bold text-white">\${initials}</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-white text-sm truncate">@\${esc(h.creator)}</p>
          <p class="text-[11px] text-slate-500">\${h.isVideo?'🎬 Reel':'🖼 Post'} · ▶ \${fmtN(h.plays)} · ♥ \${fmtN(h.likes)} · 💬 \${fmtN(h.comments)}</p>
        </div>
        <span class="text-[10px] font-mono text-slate-600">#\${h.rank}</span>
      </div>
      \${thumb}
      <div class="p-4 flex-1 flex flex-col gap-3">
        <blockquote class="text-lg font-bold text-white leading-snug border-l-2 border-fuchsia-400/60 pl-3">"\${esc(h.hook)}"</blockquote>
        <span class="self-start text-[10px] font-semibold uppercase tracking-wide bg-white/5 border border-white/10 text-slate-300 px-2 py-1 rounded-md">\${esc(ai.hookType)}</span>
        <div class="mt-auto rounded-xl border border-\${c}-400/25 bg-gradient-to-br from-\${c}-500/10 to-transparent p-3.5">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[11px] font-bold uppercase tracking-wider text-\${c}-300">⚡ Força do hook</span>
            <span class="text-sm font-extrabold text-\${c}-300 font-mono">\${ai.hookScore ?? '—'}<span class="text-[10px] text-slate-500">/100</span></span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-2">\${esc(ai.insight)}</p>
          \${ai.adapt ? \`<p class="text-xs text-cyan-300/90 leading-relaxed"><span class="font-semibold text-cyan-300">↳ Adapta pra Vault:</span> \${esc(ai.adapt)}</p>\` : ''}
        </div>
        \${h.url ? \`<a href="\${esc(h.url)}" target="_blank" rel="noopener" class="text-[11px] text-slate-500 hover:text-slate-300">Ver post original ↗</a>\` : ''}
      </div>
    </article>\`;
  }

  let state = { type: 'all', sort: 'eng' };
  const grid = document.getElementById('grid');
  const types = ['all', ...new Set(hooks.map(h => h.cat))];

  function apply() {
    let list = hooks.slice();
    if (state.type !== 'all') list = list.filter(h => h.cat === state.type);
    const sorters = { eng:(a,b)=>(b.plays+b.likes*5)-(a.plays+a.likes*5), score:(a,b)=>(b.ai.hookScore||0)-(a.ai.hookScore||0) };
    list.sort(sorters[state.sort]);
    grid.innerHTML = list.map(card).join('');
  }
  function btn(id,label,active){return \`<button data-id="\${esc(id)}" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition \${active?'bg-fuchsia-500 text-white':'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'}">\${esc(label)}</button>\`;}
  function paint() {
    document.getElementById('filters').innerHTML = types.map(t => btn(t, t==='all'?'Todos os tipos':t, state.type===t)).join('');
    document.getElementById('sorts').innerHTML = [['eng','Engajamento'],['score','Força do hook']].map(([id,l])=>btn(id,l,state.sort===id)).join('');
    document.querySelectorAll('#filters button').forEach(b=>b.onclick=()=>{state.type=b.dataset.id;paint();apply();});
    document.querySelectorAll('#sorts button').forEach(b=>b.onclick=()=>{state.sort=b.dataset.id;paint();apply();});
  }
  paint(); apply();
</script>
</body>
</html>`;

await writeFile("hooks.html", html, "utf8");
console.log(`✅ hooks.html gerado (${hooks.length} hooks).`);

const server = createServer(async (req, res) => {
  try {
    const file = req.url === "/" || req.url.startsWith("/?") ? "hooks.html" : req.url.slice(1);
    const data = await readFile(file);
    const type = file.endsWith(".html") ? "text/html" : "text/plain";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
});
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`🌐 Servindo em ${url}`);
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
});

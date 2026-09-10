/* Painel de Mercado — app.js */
(() => {
'use strict';

// ---------------- configuração padrão ----------------
const LS_KEY = 'painel.v1';
const DEFAULTS = {
  workerUrl: '',
  refreshSec: 60,
  strip: ['^BVSP', 'IFIX.SA', '^GSPC', '^IXIC', 'BRL=X', 'DX-Y.NYB', '^TNX', 'BZ=F'],
  fx: ['BRL=X', 'EURBRL=X', 'DX-Y.NYB', 'BZ=F', 'TIO=F', 'GC=F', 'ZS=F', 'BTC-USD'],
  idx: ['^BVSP', 'IFIX.SA', '^GSPC', '^IXIC', '^DJI', '^RUT', '^STOXX', '^N225', 'EEM'],
  incorp: ['CYRE3.SA', 'EZTC3.SA', 'MRVE3.SA', 'DIRR3.SA', 'TEND3.SA', 'EVEN3.SA', 'TRIS3.SA', 'PLPL3.SA', 'LAVV3.SA', 'JHSF3.SA', 'HBOR3.SA', 'MELK3.SA', 'CURY3.SA', 'MDNE3.SA', 'GFSA3.SA', 'TCSA3.SA'],
  fii: ['HGLG11.SA', 'KNRI11.SA', 'XPML11.SA', 'HGRE11.SA', 'BTLG11.SA', 'VISC11.SA', 'PVBI11.SA', 'JSRE11.SA', 'TRXF11.SA', 'RBRP11.SA', 'HGBS11.SA', 'KNCR11.SA', 'CPTS11.SA', 'HSML11.SA', 'BRCO11.SA', 'KNIP11.SA'],
  br: ['VALE3.SA', 'PETR4.SA', 'ITUB4.SA', 'BBDC4.SA', 'BBAS3.SA', 'WEGE3.SA', 'B3SA3.SA', 'ABEV3.SA', 'RENT3.SA', 'SUZB3.SA', 'AXIA3.SA', 'PRIO3.SA'],
  us: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'XOM', 'LLY', 'AVGO'],
  ust: ['^FVX', '^TNX', '^TYX', '^VIX'],
  // Copom e FOMC 2026 (calendários oficiais — confira no início de cada ano)
  agenda: [
    '2026-09-16 18:30 Copom — decisão !', '2026-09-16 15:00 FOMC — decisão !',
    '2026-10-28 15:00 FOMC — decisão !', '2026-11-04 18:30 Copom — decisão !',
    '2026-12-09 15:00 FOMC — decisão !', '2026-12-09 18:30 Copom — decisão !'
  ]
};
const LABELS = {
  '^BVSP': 'IBOV', 'IFIX.SA': 'IFIX', '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^RUT': 'Russell 2000',
  '^STOXX': 'Stoxx 600', '^N225': 'Nikkei 225', 'EEM': 'MSCI EM (ETF)', 'BRL=X': 'USD/BRL', 'EURBRL=X': 'EUR/BRL',
  'DX-Y.NYB': 'DXY', 'BZ=F': 'Brent (US$)', 'TIO=F': 'Minério 62% (US$)', 'GC=F': 'Ouro (US$)', 'ZS=F': 'Soja (¢/bu)',
  'BTC-USD': 'Bitcoin (US$)', '^FVX': 'UST 5a', '^TNX': 'UST 10a', '^TYX': 'UST 30a', '^VIX': 'VIX'
};
const SGS = {
  selic: 432, cdi: 4389, ptax: 1, ipca12: 13522, ipca: 433, igpm: 189, incc: 192, ibcbr: 24364,
  poupSaldo: 1828, finPFmercado: 20772, finPFregulado: 20773
};

// ---------------- estado ----------------
let cfg = load();
let cache = { daily: {}, intraday: {}, sgs: {}, focus: null, tesouro: null };
let timer = null;

function load() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
  catch { return Object.assign({}, DEFAULTS); }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }

// ---------------- util ----------------
const $ = s => document.querySelector(s);
const el = (id) => document.getElementById(id);
const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPrice = (v, sym = '') => {
  if (v == null) return '—';
  if (/=X$/.test(sym)) return fmt(v, 4);
  if (Math.abs(v) >= 10000) return fmt(v, 0);
  if (Math.abs(v) >= 1000) return fmt(v, 1);
  return fmt(v, 2);
};
const cls = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const pctTd = v => `<td class="num ${cls(v)}">${v == null ? '—' : (v > 0 ? '+' : '') + fmt(v) + '%'}</td>`;
const bpsTd = (v, invert = false) => { const c = v == null ? 'flat' : (invert ? -v : v) > 0 ? 'up' : (invert ? -v : v) < 0 ? 'down' : 'flat'; return `<td class="num ${c}">${v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v) + ' bps'}</td>`; };
const kv = (label, value, sub = '', c = '') => `<div><small>${label}</small><span class="num ${c}">${value}</span>${sub ? `<span class="num sub2">${sub}</span>` : ''}</div>`;
const label = s => LABELS[s] || s.replace(/\.SA$/, '');
const parseBr = d => { const [dd, mm, yy] = d.split('/'); return new Date(+yy, +mm - 1, +dd); };
const mesAno = d => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(d.getFullYear()).slice(2);

function spark(pts, up) {
  if (!pts || pts.length < 2) return '';
  const w = 120, h = 30, min = Math.min(...pts), max = Math.max(...pts);
  const p = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? '#3ecf8e' : '#f0645a'}" stroke-width="1.5" points="${p}"/></svg>`;
}
function toast(msg) { const t = el('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); }
function banner(html, kind = '') { el('banner').innerHTML = html ? `<div class="banner ${kind}">${html}</div>` : ''; }

// ---------------- rede ----------------
async function api(path) {
  if (!cfg.workerUrl) throw new Error('proxy não configurado');
  const r = await fetch(cfg.workerUrl.replace(/\/$/, '') + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`proxy HTTP ${r.status}`);
  return r.json();
}
async function yahoo(symbols, range = '1y', interval = '1d') {
  const uniq = [...new Set(symbols.filter(Boolean))];
  const chunks = []; for (let i = 0; i < uniq.length; i += 25) chunks.push(uniq.slice(i, i + 25));
  const parts = await Promise.all(chunks.map(c => api(`/yahoo?symbols=${encodeURIComponent(c.join(','))}&range=${range}&interval=${interval}`)));
  return Object.assign({}, ...parts.map(p => p.data));
}
function fedSymbols(n = 8) {
  const codes = 'FGHJKMNQUVXZ'; const out = []; const d = new Date();
  for (let i = 0; i < n; i++) { const m = (d.getMonth() + i) % 12, y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12); out.push({ sym: `ZQ${codes[m]}${String(y).slice(2)}.CBT`, m, y }); }
  return out;
}

// ---------------- carga ----------------
async function refresh() {
  if (!cfg.workerUrl) { banner('Configure a URL do proxy (Cloudflare Worker) para o painel começar a buscar dados. <button id="b-cfg">Abrir configurações</button>'); el('b-cfg').onclick = openSettings; renderAll(); return; }
  banner('');
  const fed = fedSymbols();
  const all = [...cfg.strip, ...cfg.fx, ...cfg.idx, ...cfg.incorp, ...cfg.fii, ...cfg.br, ...cfg.us, ...cfg.ust, ...fed.map(f => f.sym)];
  const jobs = [
    yahoo(all).then(d => { cache.daily = d; renderQuotes(); }),
    yahoo(cfg.strip, '1d', '5m').then(d => { cache.intraday = d; renderStrip(); }),
    api(`/bcb/sgs?codes=${Object.values(SGS).join(',')}&n=14`).then(d => { cache.sgs = d.data; renderJuros(); renderMacro(); }),
    api(`/bcb/focus?ano=${new Date().getFullYear()}`).then(d => { cache.focus = d; renderJuros(); renderMacro(); }).catch(e => console.warn('focus', e)),
    fetch('data/tesouro.json?_=' + Date.now()).then(r => r.ok ? r.json() : null).then(d => { cache.tesouro = d; renderTesouro(); }).catch(() => {})
  ];
  const res = await Promise.allSettled(jobs);
  const fail = res.filter(r => r.status === 'rejected');
  if (fail.length) banner(`Falha ao buscar dados: ${fail.map(f => f.reason && f.reason.message).join(' · ')} <button id="b-retry">Tentar de novo</button>`, 'err'), el('b-retry').onclick = refresh;
  el('clock').textContent = new Date().toLocaleTimeString('pt-BR');
}
function schedule() { clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, Math.max(30, cfg.refreshSec) * 1000); }

// ---------------- render ----------------
function renderAll() { renderAgenda(); renderStrip(); renderQuotes(); renderJuros(); renderTesouro(); renderMacro(); }

function renderAgenda() {
  const now = new Date(); const today = now.toISOString().slice(0, 10);
  const evs = (cfg.agenda || []).map(l => {
    const m = l.trim().match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s+(.*?)\s*(!)?$/); if (!m) return null;
    return { d: m[1], t: m[2] || '', e: m[3], hi: !!m[4], ts: new Date(m[1] + 'T' + (m[2] || '23:59')) };
  }).filter(Boolean).filter(e => e.ts >= new Date(now.getTime() - 3 * 3600e3)).sort((a, b) => a.ts - b.ts).slice(0, 8);
  const lbl = e => { const d = new Date(e.d + 'T12:00'); const dd = e.d === today ? 'hoje' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, ''); return dd + (e.t ? ' ' + e.t : ''); };
  el('agenda').innerHTML = `<div class="ag-lbl">Agenda</div>` + (evs.length ? evs.map(e => `<div class="ev ${e.hi ? 'hi' : ''} ${e.d === today ? 'today' : ''}"><span class="t">${lbl(e)}</span><span class="e">${e.e}</span></div>`).join('') : `<div class="ev"><span class="c">Sem eventos. Adicione em ⚙ Configurações.</span></div>`);
}

function renderStrip() {
  el('strip').innerHTML = cfg.strip.map(s => {
    const d = cache.daily[s] || {}, i = cache.intraday[s] || {};
    const price = d.price ?? i.price, chg = d.chg1d, up = chg == null ? true : chg >= 0;
    const val = s === '^TNX' || s === '^FVX' || s === '^TYX' ? fmt(price, 3) + '%' : fmtPrice(price, s);
    const chgTxt = chg == null ? '<span class="skel">—</span>' : (s.startsWith('^T') || s === '^FVX' ? `${chg >= 0 ? '+' : ''}${fmt((price - d.prevClose) * 100, 1)} bps` : `${up ? '▲' : '▼'} ${fmt(Math.abs(chg))}%`);
    return `<div class="card"><div class="lbl"><span>${label(s)}</span><span class="dot ${d.delayed ? 'delay' : 'live'}"></span></div><div class="val num">${val}</div><div class="chg num ${up ? 'up' : 'down'}">${chgTxt}</div>${spark(i.spark && i.spark.length > 3 ? i.spark : d.spark, up)}</div>`;
  }).join('');
}

function quoteRow(s, editable, cols) {
  const d = cache.daily[s];
  const name = editable ? `<td class="tk"><span class="sym">${s.replace(/\.SA$/, '')}</span>${d && d.name && !d.error ? `<span class="name">${short(d.name)}</span>` : ''}</td>` : `<td>${label(s)}</td>`;
  if (!d) return `<tr>${name}<td class="num skel" colspan="${cols}">carregando…</td></tr>`;
  if (d.error) return `<tr class="err">${name}<td colspan="${cols}">${d.error === 'HTTP 404' ? 'ticker não encontrado' : d.error}</td></tr>`;
  let r = `<tr>${name}<td class="num">${fmtPrice(d.price, s)}</td>${pctTd(d.chg1d)}${pctTd(d.chgMtd)}${pctTd(d.chgYtd)}`;
  if (cols >= 5) r += pctTd(d.chg12m);
  return r + '</tr>';
}
const short = n => n.replace(/\s+(ON|PN|NM|N1|N2|ER|CI|FII)\b.*$/i, '').replace(/\s{2,}/g, ' ').trim().slice(0, 22);

function renderQuotes() {
  el('fx').innerHTML = cfg.fx.map(s => quoteRow(s, false, 4)).join('');
  el('idx').innerHTML = cfg.idx.map(s => quoteRow(s, false, 4)).join('');
  for (const k of ['incorp', 'fii', 'br', 'us']) el(k + '-b').innerHTML = cfg[k].map(s => quoteRow(s, true, 5)).join('');
  renderStrip(); renderFed(); renderUst(); renderFiiKv(); renderJuros();
}

function renderFed() {
  const fed = fedSymbols(); const rows = [];
  const first = cache.daily[fed[0].sym];
  const cur = first && first.price != null ? 100 - first.price : null;
  for (const f of fed) {
    const d = cache.daily[f.sym]; if (!d || d.price == null) continue;
    const imp = 100 - d.price, d1 = d.prevClose != null ? (d.prevClose - d.price) * 100 : null;
    const mes = mesAno(new Date(f.y, f.m, 1));
    rows.push(`<tr><td>${mes}</td><td class="num">${fmt(imp, 3)}%</td>${bpsTd(cur == null ? null : (imp - cur) * 100, true)}${bpsTd(d1, true)}</tr>`);
  }
  el('fed').innerHTML = rows.length ? rows.join('') : `<tr><td colspan="4" class="skel">carregando…</td></tr>`;
}
function renderUst() {
  el('ust-kv').innerHTML = cfg.ust.map(s => { const d = cache.daily[s] || {}; const isY = s !== '^VIX'; const v = d.price == null ? '—' : (isY ? fmt(d.price, 3) + '%' : fmt(d.price, 2)); const sub = d.price == null || d.prevClose == null ? '' : (isY ? `${(d.price - d.prevClose) >= 0 ? '+' : ''}${fmt((d.price - d.prevClose) * 100, 1)} bps` : `${d.chg1d >= 0 ? '+' : ''}${fmt(d.chg1d)}%`); return kv(label(s), v, sub, isY ? cls(-(d.price - d.prevClose)) : cls(d.chg1d)); }).join('');
}
function renderFiiKv() {
  const ifix = cache.daily['IFIX.SA'] || {};
  const b35 = tesouroBond('IPCA+', 2035);
  el('fii-kv').innerHTML = kv('IFIX', fmtPrice(ifix.price), ifix.chg1d == null ? '' : `${ifix.chg1d >= 0 ? '+' : ''}${fmt(ifix.chg1d)}%`, cls(ifix.chg1d)) + kv('NTN-B 2035 (real)', b35 ? fmt(b35.taxa) + '%' : '—') + kv('Prêmio FIIs (DY − NTN-B)', '—', 'fase 2') + kv('IFIX Δ ano / 12m', ifix.chgYtd == null ? '—' : `${fmt(ifix.chgYtd)}% / ${fmt(ifix.chg12m)}%`);
}

// ---- BCB / Focus ----
const sgsLast = k => { const a = cache.sgs[SGS[k]]; return Array.isArray(a) && a.length ? a[a.length - 1] : null; };
const sgsPrev = k => { const a = cache.sgs[SGS[k]]; return Array.isArray(a) && a.length > 1 ? a[a.length - 2] : null; };
const sgs12 = k => { const a = cache.sgs[SGS[k]]; if (!Array.isArray(a) || a.length < 12) return null; return (a.slice(-12).reduce((acc, x) => acc * (1 + x.valor / 100), 1) - 1) * 100; };
const focus = (ind, ref) => { const f = cache.focus && cache.focus.anuais && cache.focus.anuais.find(x => x.indicador === ind && String(x.referencia) === String(ref)); return f ? f.mediana : null; };
const focusIpca12 = () => cache.focus && cache.focus.ipca12m ? cache.focus.ipca12m.mediana : null;

function renderJuros() {
  const y = new Date().getFullYear();
  const selic = sgsLast('selic'), cdi = sgsLast('cdi');
  el('juros-kv1').innerHTML =
    kv('Selic meta (432)', selic ? fmt(selic.valor) + '%' : '—') +
    kv('CDI a.a. (4389)', cdi ? fmt(cdi.valor) + '%' : '—', cdi ? cdi.data.slice(0, 5) : '') +
    kv(`Focus Selic fim/${String(y).slice(2)}`, focus('Selic', y) != null ? fmt(focus('Selic', y)) + '%' : '—', focus('Selic', y + 1) != null ? `${String(y + 1).slice(2)}: ${fmt(focus('Selic', y + 1))}%` : '') +
    kv(`Focus IPCA ${String(y).slice(2)}`, focus('IPCA', y) != null ? fmt(focus('IPCA', y)) + '%' : '—', focus('IPCA', y + 1) != null ? `${String(y + 1).slice(2)}: ${fmt(focus('IPCA', y + 1))}%` : '');

  const pre = tesouroList('Prefixado');
  const curto = pre[0], longo = pre[pre.length - 1];
  const incl = curto && longo && pre.length > 1 ? (longo.taxa - curto.taxa) * 100 : null;
  const inclSem = curto && longo && pre.length > 1 && curto.sem != null && longo.sem != null ? (longo.sem - curto.sem) : null;
  const ipca12 = focusIpca12();
  const um = pre.find(b => b.anos >= 0.9) || curto;
  const real = um && ipca12 != null ? ((1 + um.taxa / 100) / (1 + ipca12 / 100) - 1) * 100 : null;
  const ff = cache.daily[fedSymbols()[0].sym];
  const dif = cdi && ff && ff.price != null ? cdi.valor - (100 - ff.price) : null;
  el('juros-kv2').innerHTML =
    kv(curto && longo ? `Inclinação ${curto.vencAno}–${longo.vencAno} (pré)` : 'Inclinação da curva pré', incl == null ? '—' : `${incl > 0 ? '+' : ''}${Math.round(incl)} bps`, inclSem == null ? '' : `${inclSem > 0 ? '+' : ''}${Math.round(inclSem)} bps na semana`, cls(-inclSem)) +
    kv(um ? `Juro real ex-ante (pré ${um.vencAno} − Focus 12m)` : 'Juro real ex-ante', real == null ? '—' : fmt(real) + '%', ipca12 == null ? '' : `IPCA 12m: ${fmt(ipca12)}%`) +
    kv(`Focus câmbio fim/${String(y).slice(2)}`, focus('Câmbio', y) != null ? fmt(focus('Câmbio', y)) : '—', focus('PIB Total', y) != null ? `PIB ${String(y).slice(2)}: ${fmt(focus('PIB Total', y))}%` : '') +
    kv('Diferencial CDI − Fed Funds', dif == null ? '—' : fmt(dif) + ' p.p.');
}

// ---- Tesouro ----
function tesouroList(tipoRe) {
  const t = cache.tesouro; if (!t || !t.bonds) return [];
  const re = new RegExp(tipoRe, 'i'); const now = new Date();
  return t.bonds.filter(b => re.test(b.tipo) && !/Renda\+|Educa\+|Selic/i.test(b.tipo)).map(b => {
    const s = b.serie.filter(x => x[1] != null); if (!s.length) return null;
    const last = s[s.length - 1], d1 = s.length > 1 ? s[s.length - 2] : null;
    const lastDate = new Date(last[0]); const wk = [...s].reverse().find(x => (lastDate - new Date(x[0])) / 86400e3 >= 6) || null;
    const venc = new Date(b.venc);
    return { tipo: b.tipo, venc: b.venc, vencAno: venc.getFullYear(), anos: (venc - now) / (365.25 * 86400e3), taxa: last[1], dia: d1 ? (last[1] - d1[1]) * 100 : null, sem: wk ? (last[1] - wk[1]) * 100 : null, semestral: /Semestrais/i.test(b.tipo) };
  }).filter(Boolean).sort((a, b) => new Date(a.venc) - new Date(b.venc));
}
const tesouroBond = (tipoRe, ano) => tesouroList(tipoRe).find(b => b.vencAno === ano && !b.semestral) || tesouroList(tipoRe).find(b => b.vencAno === ano) || null;
const bondName = b => (/IPCA/i.test(b.tipo) ? 'NTN-B' : b.semestral ? 'NTN-F' : 'LTN') + (b.semestral && /IPCA/i.test(b.tipo) ? ' (juros sem.)' : '') + ' ' + b.vencAno;

function renderTesouro() {
  const t = cache.tesouro;
  el('curva-asof').textContent = t && t.asOf ? `· base ${t.asOf.split('-').reverse().join('/')}` : '';
  const pre = tesouroList('Prefixado'), ntnb = tesouroList('IPCA\\+');
  if (!pre.length) { el('pre').innerHTML = `<tr><td colspan="5" class="skel">${t ? 'sem dados do Tesouro — rode a Action "Dados diários" no GitHub' : 'carregando…'}</td></tr>`; el('ntnb').innerHTML = `<tr><td colspan="7" class="skel">—</td></tr>`; el('curva-chart').innerHTML = ''; return; }
  el('pre').innerHTML = pre.map(b => `<tr><td>${bondName(b)}</td><td class="num">${b.venc.split('-').reverse().join('/')}</td><td class="num">${fmt(b.taxa)}%</td>${bpsTd(b.dia, true)}${bpsTd(b.sem, true)}</tr>`).join('');

  // implícita: pré × NTN-B de mesmo ano (ou mais próximo até 1 ano de diferença)
  el('ntnb').innerHTML = ntnb.map(b => {
    let m = pre.find(p => p.vencAno === b.vencAno) || pre.find(p => Math.abs(p.vencAno - b.vencAno) <= 1);
    const imp = m ? ((1 + m.taxa / 100) / (1 + b.taxa / 100) - 1) * 100 : null;
    const impSem = m && m.sem != null && b.sem != null ? (m.sem - b.sem) : null;
    return `<tr><td>${bondName(b)}</td><td class="num">${b.venc.split('-').reverse().join('/')}</td><td class="num">${fmt(b.taxa)}%</td>${bpsTd(b.dia, true)}${bpsTd(b.sem, true)}<td class="num">${imp == null ? '—' : fmt(imp) + '%'}${m && m.vencAno !== b.vencAno ? `<span class="name">vs pré ${m.vencAno}</span>` : ''}</td>${bpsTd(impSem, true)}</tr>`;
  }).join('');
  renderCurva(pre); renderJuros(); renderFiiKv();
}

function renderCurva(pre) {
  // três curvas: hoje, D-1, D-7 a partir das séries por título
  const t = cache.tesouro; const dates = [...new Set(t.bonds.flatMap(b => b.serie.map(x => x[0])))].sort();
  const last = dates[dates.length - 1], d1 = dates[dates.length - 2], d7 = [...dates].reverse().find(d => (new Date(last) - new Date(d)) / 86400e3 >= 6) || dates[0];
  const at = (b, d) => { const x = t.bonds.find(z => z.tipo === b.tipo && z.venc === b.venc); const p = x && x.serie.find(s => s[0] === d); return p ? p[1] : null; };
  const series = [[d7, '#5f6c7c', '4 3'], [d1, '#9aa7b7', ''], [last, '#3ecf8e', '']].map(([d, c, dash]) => ({ c, dash, pts: pre.map(b => [b.anos, at(b, d)]).filter(p => p[1] != null) }));
  const all = series.flatMap(s => s.pts.map(p => p[1])); if (!all.length) return;
  const min = Math.floor(Math.min(...all) * 4) / 4 - 0.25, max = Math.ceil(Math.max(...all) * 4) / 4 + 0.25;
  const xmax = Math.max(...pre.map(b => b.anos)) + 0.5, W = 320, H = 150, L = 8, R = 34, T = 8, B = 22;
  const X = a => L + (a / xmax) * (W - L - R), Y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const grid = []; for (let v = Math.ceil(min * 2) / 2; v <= max; v += 0.5) grid.push(`<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - R}" y2="${Y(v).toFixed(1)}" stroke="#26313f"/><text x="${W - 2}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" fill="#5f6c7c" font-size="9" font-family="IBM Plex Mono,monospace">${fmt(v, 1)}</text>`);
  const xl = pre.map(b => `<text x="${X(b.anos).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#5f6c7c" font-size="9" font-family="IBM Plex Mono,monospace">${b.vencAno}</text>`);
  const lines = series.map(s => `<polyline fill="none" stroke="${s.c}" stroke-width="${s.c === '#3ecf8e' ? 2 : 1.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`);
  const dots = series[2].pts.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.5" fill="#3ecf8e"/>`);
  el('curva-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid.join('')}${lines.join('')}${dots.join('')}${xl.join('')}</svg>`;
}

// ---- macro / funding ----
function renderMacro() {
  const y = new Date().getFullYear();
  const ipca12 = sgsLast('ipca12'), ipca = sgsLast('ipca'), igpm = sgsLast('igpm'), incc = sgsLast('incc'), ibc = sgsLast('ibcbr'), ibcP = sgsPrev('ibcbr');
  const ref = x => x ? mesAno(parseBr(x.data)) : '';
  el('macro-kv').innerHTML =
    kv('IPCA 12m (13522)', ipca12 ? fmt(ipca12.valor) + '%' : '—', ref(ipca12)) +
    kv('IPCA mensal (433)', ipca ? fmt(ipca.valor) + '%' : '—', ref(ipca)) +
    kv('IGP-M 12m (189)', sgs12('igpm') != null ? fmt(sgs12('igpm')) + '%' : '—', igpm ? `${ref(igpm)} ${fmt(igpm.valor)}%` : '') +
    kv('INCC-DI 12m (192)', sgs12('incc') != null ? fmt(sgs12('incc')) + '%' : '—', incc ? `${ref(incc)} ${fmt(incc.valor)}%` : '') +
    kv('IBC-Br m/m (24364)', ibc && ibcP ? `${fmt((ibc.valor / ibcP.valor - 1) * 100)}%` : '—', ref(ibc)) +
    kv(`Focus PIB ${String(y).slice(2)}`, focus('PIB Total', y) != null ? fmt(focus('PIB Total', y)) + '%' : '—') +
    kv('PTAX venda (1)', sgsLast('ptax') ? fmt(sgsLast('ptax').valor, 4) : '—', sgsLast('ptax') ? sgsLast('ptax').data.slice(0, 5) : '');

  const ps = sgsLast('poupSaldo'), psP = sgsPrev('poupSaldo');
  const fm = sgsLast('finPFmercado'), fr = sgsLast('finPFregulado');
  const bi = v => v == null ? '—' : 'R$ ' + fmt(v / 1e6, 0) + ' bi';
  const dif = ps && psP ? (ps.valor - psP.valor) / 1e6 : null;
  el('funding-kv').innerHTML =
    kv('Saldo poupança (1828)', ps ? bi(ps.valor) : '—', ref(ps)) +
    kv('Δ saldo poupança no mês', dif == null ? '—' : `${dif >= 0 ? '+' : '−'}R$ ${fmt(Math.abs(dif), 1)} bi`, 'inclui rendimento', cls(dif)) +
    kv('Financ. imob. PF — taxa mercado (20772)', fm ? fmt(fm.valor) + '% a.a.' : '—', ref(fm)) +
    kv('Financ. imob. PF — taxa regulada (20773)', fr ? fmt(fr.valor) + '% a.a.' : '—', ref(fr)) +
    kv('Captação líq. poupança', '—', 'fase 2 (ABECIP)') +
    kv('Spread CRI (IDA-DI)', '—', 'fase 2 (Anbima)') +
    kv('Fluxo estrangeiro B3', '—', 'fase 2 (B3)');
}

// ---------------- edição de tickers ----------------
function normalize(v, listKey) {
  v = v.trim().toUpperCase(); if (!v) return '';
  if (['incorp', 'fii', 'br'].includes(listKey) && /^[A-Z]{4}\d{1,2}$/.test(v)) v += '.SA';
  return v;
}
document.querySelectorAll('tbody[data-list]').forEach(tb => tb.addEventListener('click', e => {
  const td = e.target.closest('td.tk'); if (!td || td.querySelector('input')) return;
  const listKey = tb.dataset.list; const tr = td.parentElement; const idx = [...tb.children].indexOf(tr);
  const old = cfg[listKey][idx]; const sym = td.querySelector('.sym');
  const inp = document.createElement('input'); inp.value = old.replace(/\.SA$/, '');
  sym.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = commit => {
    if (done) return; done = true;
    const v = normalize(inp.value, listKey);
    if (!commit || v === old) { renderQuotes(); return; }
    if (!v) { cfg[listKey].splice(idx, 1); save(); renderQuotes(); toast(`${old.replace(/\.SA$/, '')} removido`); return; }
    cfg[listKey][idx] = v; save(); renderQuotes();
    yahoo([v]).then(d => { Object.assign(cache.daily, d); renderQuotes(); if (d[v] && d[v].error) toast(`${v}: ${d[v].error === 'HTTP 404' ? 'ticker não encontrado no Yahoo' : d[v].error}`); }).catch(err => toast(err.message));
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}));
document.querySelectorAll('button[data-add]').forEach(b => b.onclick = () => {
  const k = b.dataset.add; const v = normalize(prompt('Ticker (ex.: CYRE3, HGLG11, AAPL):') || '', k); if (!v) return;
  if (cfg[k].includes(v)) return toast('já está na lista');
  cfg[k].push(v); save(); renderQuotes();
  yahoo([v]).then(d => { Object.assign(cache.daily, d); renderQuotes(); }).catch(err => toast(err.message));
});

// ---------------- configurações ----------------
function openSettings() {
  el('cfg-worker').value = cfg.workerUrl || ''; el('cfg-refresh').value = cfg.refreshSec; el('cfg-agenda').value = (cfg.agenda || []).join('\n');
  el('modal').classList.add('open'); el('cfg-worker').focus();
}
el('btn-settings').onclick = openSettings;
el('cfg-cancel').onclick = () => el('modal').classList.remove('open');
el('modal').addEventListener('click', e => { if (e.target === el('modal')) el('modal').classList.remove('open'); });
el('cfg-save').onclick = () => {
  cfg.workerUrl = el('cfg-worker').value.trim().replace(/\/$/, '');
  cfg.refreshSec = Math.max(30, parseInt(el('cfg-refresh').value, 10) || 60);
  cfg.agenda = el('cfg-agenda').value.split('\n').map(s => s.trim()).filter(Boolean);
  save(); el('modal').classList.remove('open'); toast('salvo'); renderAgenda(); schedule(); refresh();
};
el('cfg-reset').onclick = () => {
  if (!confirm('Restaurar as listas de tickers e a agenda padrão? A URL do proxy é mantida.')) return;
  const w = cfg.workerUrl, r = cfg.refreshSec; cfg = Object.assign({}, DEFAULTS, { workerUrl: w, refreshSec: r }); save(); el('modal').classList.remove('open'); renderAll(); refresh();
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

// ---------------- PWA ----------------
if (navigator.serviceWorker) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------------- início ----------------
renderAll(); refresh(); schedule();
})();

// Painel de Mercado — proxy Cloudflare Worker
// Rotas:
//   GET /yahoo?symbols=^BVSP,CYRE3.SA&range=1y&interval=1d   (máx. 25 símbolos por chamada)
//   GET /yahoo?symbols=^BVSP&range=1d&interval=5m             (intraday p/ sparkline)
//   GET /bcb/sgs?codes=432,4389&n=13
//   GET /bcb/focus?ano=2026
// Cache na borda (caches.default) com TTL por rota. CORS restrito a ALLOWED_ORIGINS.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const TTL = { yahoo1y: 300, yahooIntraday: 60, sgs: 1800, focus: 3600 };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin) || !origin;
    const cors = corsHeaders(originOk ? (origin || '*') : 'null');

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);

    // cache por URL completa (ignora Origin)
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors, { 'X-Cache': 'HIT' });

    try {
      let payload, ttl;
      if (url.pathname === '/yahoo') {
        ({ payload, ttl } = await routeYahoo(url));
      } else if (url.pathname === '/bcb/sgs') {
        ({ payload, ttl } = await routeSgs(url));
      } else if (url.pathname === '/bcb/focus') {
        ({ payload, ttl } = await routeFocus(url));
      } else if (url.pathname === '/health') {
        return json({ ok: true, ts: Date.now() }, 200, cors);
      } else {
        return json({ error: 'not found' }, 404, cors);
      }
      const res = json(payload, 200, { 'Cache-Control': `public, max-age=${ttl}` });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return withHeaders(res, cors, { 'X-Cache': 'MISS' });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  }
};

// ---------- Yahoo ----------
async function routeYahoo(url) {
  const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
  const range = url.searchParams.get('range') || '1y';
  const interval = url.searchParams.get('interval') || '1d';
  if (!symbols.length) throw new Error('symbols obrigatório');
  const intraday = interval.endsWith('m') || interval.endsWith('h');

  const results = await Promise.all(symbols.map(async sym => {
    try {
      const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (!r.ok) return [sym, { error: `HTTP ${r.status}` }];
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) return [sym, { error: (j.chart && j.chart.error && j.chart.error.description) || 'sem dados' }];
      return [sym, intraday ? shapeIntraday(res) : shapeDaily(res)];
    } catch (e) {
      return [sym, { error: String(e.message || e) }];
    }
  }));
  return { payload: { asOf: Date.now(), data: Object.fromEntries(results) }, ttl: intraday ? TTL.yahooIntraday : TTL.yahoo1y };
}

function baseMeta(res) {
  const m = res.meta || {};
  return {
    symbol: m.symbol, name: m.shortName || m.longName || m.symbol, currency: m.currency,
    exchange: m.exchangeName, price: m.regularMarketPrice, time: m.regularMarketTime,
    delayed: /SAO|BVMF/i.test(m.exchangeName || '')
  };
}

function shapeIntraday(res) {
  const out = baseMeta(res);
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  out.spark = closes.filter(v => v != null);
  out.prevClose = res.meta && (res.meta.chartPreviousClose ?? res.meta.previousClose);
  return out;
}

function shapeDaily(res) {
  const out = baseMeta(res);
  const ts = res.timestamp || [];
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null) pts.push([ts[i], closes[i]]);
  if (!pts.length) { out.error = 'sem histórico'; return out; }

  const price = out.price ?? pts[pts.length - 1][1];
  const lastTs = out.time ?? pts[pts.length - 1][0];
  const dayKey = t => new Date(t * 1000).toISOString().slice(0, 10);
  const lastDay = dayKey(lastTs);

  // fechamento anterior: último ponto de um dia anterior ao dia do último preço
  let prev = null;
  for (let i = pts.length - 1; i >= 0; i--) if (dayKey(pts[i][0]) < lastDay) { prev = pts[i][1]; break; }
  const now = new Date(lastTs * 1000);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  const yearAgo = lastTs - 365 * 86400;
  const lastBefore = t => { let v = null; for (const [a, b] of pts) { if (a < t) v = b; else break; } return v; };
  const nearest = t => { let best = null, d = Infinity; for (const [a, b] of pts) { const dd = Math.abs(a - t); if (dd < d) { d = dd; best = b; } } return best; };
  const pct = (a, b) => (a != null && b != null && b !== 0) ? (a / b - 1) * 100 : null;

  out.prevClose = prev;
  out.chg1d = pct(price, prev);
  out.chgMtd = pct(price, lastBefore(monthStart));
  out.chgYtd = pct(price, lastBefore(yearStart));
  out.chg12m = pct(price, nearest(yearAgo));
  out.spark = pts.slice(-30).map(p => p[1]);
  return out;
}

// ---------- BCB SGS ----------
async function routeSgs(url) {
  const codes = (url.searchParams.get('codes') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  const n = Math.min(parseInt(url.searchParams.get('n') || '2', 10) || 2, 400);
  if (!codes.length) throw new Error('codes obrigatório');
  const results = await Promise.all(codes.map(async c => {
    try {
      const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${c}/dados/ultimos/${n}?formato=json`, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return [c, { error: `HTTP ${r.status}` }];
      const j = await r.json();
      return [c, Array.isArray(j) ? j.map(x => ({ data: x.data, valor: parseFloat(String(x.valor).replace(',', '.')) })) : { error: 'formato inesperado' }];
    } catch (e) { return [c, { error: String(e.message || e) }]; }
  }));
  return { payload: { asOf: Date.now(), data: Object.fromEntries(results) }, ttl: TTL.sgs };
}

// ---------- Focus (Olinda) ----------
async function routeFocus(url) {
  const ano = url.searchParams.get('ano') || String(new Date().getFullYear());
  const anoSeg = String(parseInt(ano, 10) + 1);
  const base = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/';
  const q1 = `${base}ExpectativasMercadoAnuais?$filter=(Indicador eq 'Selic' or Indicador eq 'IPCA' or Indicador eq 'Câmbio' or Indicador eq 'PIB Total') and (DataReferencia eq '${ano}' or DataReferencia eq '${anoSeg}') and baseCalculo eq 0&$orderby=Data desc&$top=40&$format=json`;
  const q2 = `${base}ExpectativasMercadoInflacao12Meses?$filter=Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq 0&$orderby=Data desc&$top=1&$format=json`;
  const [r1, r2] = await Promise.all([fetch(q1, { headers: { Accept: 'application/json' } }), fetch(q2, { headers: { Accept: 'application/json' } })]);
  const j1 = r1.ok ? await r1.json() : { value: [] };
  const j2 = r2.ok ? await r2.json() : { value: [] };
  const anuais = {};
  for (const row of (j1.value || [])) {
    const k = `${row.Indicador}|${row.DataReferencia}`;
    if (!anuais[k]) anuais[k] = { indicador: row.Indicador, referencia: row.DataReferencia, mediana: row.Mediana, data: row.Data };
  }
  const ipca12m = (j2.value && j2.value[0]) ? { mediana: j2.value[0].Mediana, data: j2.value[0].Data } : null;
  return { payload: { asOf: Date.now(), anuais: Object.values(anuais), ipca12m }, ttl: TTL.focus };
}

// ---------- util ----------
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
function withHeaders(res, ...sets) {
  const h = new Headers(res.headers);
  for (const s of sets) for (const [k, v] of Object.entries(s)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}


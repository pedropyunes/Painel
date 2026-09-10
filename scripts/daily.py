"""
Gera data/tesouro.json a partir do CSV histórico do Tesouro Transparente
(preços e taxas do Tesouro Direto, D-1). Roda na GitHub Action diária.

Saída:
{
  "asOf": "2026-09-09",
  "bonds": [
    {"tipo": "Tesouro IPCA+", "venc": "2035-05-15", "serie": [["2026-09-01", 6.84, 6.90], ...]}
  ]
}
serie = [data base, taxa compra manhã, taxa venda manhã] — últimos ~10 pregões por título.
"""
import io, json, sys, datetime as dt, urllib.request

CSV_URL = ("https://www.tesourotransparente.gov.br/ckan/dataset/"
           "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
           "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv")
OUT = "data/tesouro.json"
KEEP_DAYS = 12

def fetch_csv():
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("latin-1")

def parse(text):
    import pandas as pd
    df = pd.read_csv(io.StringIO(text), sep=";", decimal=",", dtype=str)
    cols = {c.strip(): c for c in df.columns}
    tipo = cols.get("Tipo Titulo"); venc = cols.get("Data Vencimento"); base = cols.get("Data Base")
    tc = cols.get("Taxa Compra Manha"); tv = cols.get("Taxa Venda Manha")
    if not all([tipo, venc, base, tc, tv]):
        raise SystemExit(f"colunas inesperadas: {list(df.columns)}")
    df = df[[tipo, venc, base, tc, tv]].copy()
    df.columns = ["tipo", "venc", "base", "tc", "tv"]
    df["base"] = pd.to_datetime(df["base"], dayfirst=True, errors="coerce")
    df["venc"] = pd.to_datetime(df["venc"], dayfirst=True, errors="coerce")
    for c in ("tc", "tv"):
        df[c] = pd.to_numeric(df[c].str.replace(",", ".", regex=False), errors="coerce")
    df = df.dropna(subset=["base", "venc"])
    last = df["base"].max()
    cutoff = last - pd.Timedelta(days=KEEP_DAYS * 2)
    df = df[df["base"] >= cutoff]
    # mantém só títulos ainda em negociação na última data
    live = df[df["base"] == last][["tipo", "venc"]].drop_duplicates()
    df = df.merge(live, on=["tipo", "venc"])
    bonds = []
    for (t, v), g in df.groupby(["tipo", "venc"]):
        g = g.sort_values("base").tail(KEEP_DAYS)
        serie = [[d.strftime("%Y-%m-%d"), round(float(a), 4) if a == a else None, round(float(b), 4) if b == b else None]
                 for d, a, b in zip(g["base"], g["tc"], g["tv"])]
        bonds.append({"tipo": t.strip(), "venc": v.strftime("%Y-%m-%d"), "serie": serie})
    bonds.sort(key=lambda b: (b["tipo"], b["venc"]))
    return {"asOf": last.strftime("%Y-%m-%d"), "generated": dt.datetime.utcnow().isoformat() + "Z", "bonds": bonds}

def main():
    try:
        data = parse(fetch_csv())
    except Exception as e:
        print("falha ao gerar tesouro.json:", e, file=sys.stderr)
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ok: {len(data['bonds'])} títulos, base {data['asOf']}")

if __name__ == "__main__":
    main()

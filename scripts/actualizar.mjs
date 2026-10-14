// Busca las tasas del BCV y de Binance P2P y actualiza rates.json.
// Lo ejecuta GitHub Actions cada 30 minutos (ver .github/workflows/tasas.yml).
import { readFile, writeFile } from "node:fs/promises";

const UA = { "User-Agent": "Mozilla/5.0 (brecha-ve; +https://github.com)", "Accept": "application/json" };

async function getJSON(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn(`Falló ${url} (intento ${intento}): ${e.message}`);
      if (intento < 3) await new Promise(res => setTimeout(res, 3000 * intento));
    }
  }
  return null;
}

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

const prev = JSON.parse(await readFile("rates.json", "utf8"));
const [usd, eur, p2p] = await Promise.all([
  getJSON("https://ve.dolarapi.com/v1/dolares/oficial"),
  getJSON("https://ve.dolarapi.com/v1/euros/oficial"),
  getJSON("https://criptoya.com/api/binancep2p/USDT/VES/5"),
]);

const ask = num(p2p?.ask), bid = num(p2p?.bid);
const next = {
  bcv: num(usd?.promedio) ?? prev.bcv,
  eur: num(eur?.promedio) ?? prev.eur,
  p2p: ask && bid ? (ask + bid) / 2 : (ask ?? bid ?? prev.p2p),
  ask: ask ?? prev.ask,
  bid: bid ?? prev.bid,
  fechaBCV: usd?.fechaActualizacion ? String(usd.fechaActualizacion).slice(0, 10) : prev.fechaBCV,
};

if (!usd && !eur && !p2p) {
  console.error("No respondió ninguna fuente; no se cambia nada.");
  process.exit(0);
}

// Hora de Venezuela (UTC-4) en ISO
const ahora = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 19) + "-04:00";
next.actualizado = ahora;

// Historial: un punto cada 3 horas como mínimo, últimos 60 puntos (~1 semana)
const hist = Array.isArray(prev.hist) ? [...prev.hist] : [];
const ultimo = hist[hist.length - 1];
const punto = { t: ahora, bcv: next.bcv, p2p: next.p2p };
if (ultimo && Date.now() - new Date(ultimo.t).getTime() < 3 * 3600e3) hist[hist.length - 1] = punto;
else hist.push(punto);
next.hist = hist.slice(-60);

await writeFile("rates.json", JSON.stringify(next, null, 1) + "\n");
const brecha = ((next.p2p / next.bcv - 1) * 100).toFixed(1);
console.log(`BCV ${next.bcv} · EUR ${next.eur} · P2P ${next.p2p} · brecha ${brecha}%`);

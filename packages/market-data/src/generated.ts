import type { Quote } from "@tlp/trading-core";
import { TIMEFRAME_SECONDS, type Candle, type MarketDataProvider, type Timeframe } from "./types";

/** SIMULATED prices for development and demos. Not real market data. */
interface Profile { price: number; spread: number; precision: number; volPerMinute: number }
const PROFILES: Record<string, Profile> = {
  XAUUSD: { price: 3845.2, spread: 0.3, precision: 2, volPerMinute: 0.0003 },
  EURUSD: { price: 1.1712, spread: 0.00012, precision: 5, volPerMinute: 0.00008 },
  BTCUSD: { price: 95000, spread: 20, precision: 2, volPerMinute: 0.0006 },
};
const TICK_MS = 500;
const DEMO_VOL_BOOST = 1.5; // makes live movement easy to see while learning

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());

export class GeneratedProvider implements MarketDataProvider {
  readonly name = "generated";
  private mid: Record<string, number> = {};
  private subs = new Map<string, { timer: ReturnType<typeof setInterval>; symbols: string[] }>();
  private nextId = 1;

  private profile(symbol: string): Profile {
    const p = PROFILES[symbol];
    if (!p) throw new Error(`Generated provider has no profile for ${symbol}`);
    return p;
  }
  private currentMid(symbol: string): number { return (this.mid[symbol] ??= this.profile(symbol).price); }
  private quoteFor(symbol: string): Quote {
    const p = this.profile(symbol);
    const mid = this.currentMid(symbol);
    return { symbol, bid: (mid - p.spread / 2).toFixed(p.precision), ask: (mid + p.spread / 2).toFixed(p.precision), time: Date.now() };
  }

  async getQuote(symbol: string): Promise<Quote> { return this.quoteFor(symbol); }

  async getHistoricalCandles(symbol: string, timeframe: Timeframe, count = 300): Promise<Candle[]> {
    const p = this.profile(symbol);
    const sec = TIMEFRAME_SECONDS[timeframe];
    const end = Math.floor(Date.now() / 1000 / sec) * sec;
    const rng = mulberry32(hash(symbol + timeframe));
    const sigma = p.volPerMinute * DEMO_VOL_BOOST * Math.sqrt(sec / 60);
    let price = p.price;
    const raw: Candle[] = [];
    for (let i = 0; i < count; i++) {
      const open = price;
      const close = open * (1 + gauss(rng) * sigma);
      const high = Math.max(open, close) * (1 + Math.abs(gauss(rng)) * sigma * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(gauss(rng)) * sigma * 0.5);
      raw.push({ time: end - (count - 1 - i) * sec, open, high, low, close, volume: Math.round(100 + rng() * 900) });
      price = close;
    }
    // Rescale so history ends exactly at the current live price.
    const k = this.currentMid(symbol) / raw[raw.length - 1]!.close;
    const d = p.precision;
    return raw.map((c) => ({ ...c, open: +(c.open * k).toFixed(d), high: +(c.high * k).toFixed(d), low: +(c.low * k).toFixed(d), close: +(c.close * k).toFixed(d) }));
  }

  subscribeQuotes(symbols: string[], onQuote: (q: Quote) => void): string {
    const id = String(this.nextId++);
    const tick = () => {
      for (const s of symbols) {
        const p = this.profile(s);
        const step = p.volPerMinute * DEMO_VOL_BOOST * Math.sqrt(TICK_MS / 60000);
        this.mid[s] = this.currentMid(s) * (1 + gauss(Math.random) * step);
        onQuote(this.quoteFor(s));
      }
    };
    setTimeout(() => { for (const s of symbols) onQuote(this.quoteFor(s)); }, 0);
    this.subs.set(id, { timer: setInterval(tick, TICK_MS), symbols });
    return id;
  }

  unsubscribeQuotes(subscriptionId: string): void {
    const s = this.subs.get(subscriptionId);
    if (s) { clearInterval(s.timer); this.subs.delete(subscriptionId); }
  }
}

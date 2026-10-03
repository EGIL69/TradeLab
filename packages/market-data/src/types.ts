import type { Quote } from "@tlp/trading-core";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400,
  "1d": 86400, "1w": 604800, "1M": 2592000,
};

/** time = bucket start, in UNIX seconds. Chart data only, so plain numbers are fine. */
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

/** Every market-data source implements this. The trading engine never depends on a specific one. */
export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<Quote>;
  getHistoricalCandles(symbol: string, timeframe: Timeframe, count?: number): Promise<Candle[]>;
  /** Returns a subscription id. */
  subscribeQuotes(symbols: string[], onQuote: (q: Quote) => void): string;
  unsubscribeQuotes(subscriptionId: string): void;
}

import type { EngineConfig, Instrument } from "./types";

/** Starter instruments. Later these come from the `instruments` database table. */
export const DEFAULT_INSTRUMENTS: Instrument[] = [
  { symbol: "XAUUSD", displayName: "Gold vs US Dollar", assetType: "metal", baseCurrency: "XAU", quoteCurrency: "USD",
    pricePrecision: 2, minQty: "0.01", maxQty: "50", qtyStep: "0.01", tickSize: "0.01", contractSize: "100", enabled: true },
  { symbol: "EURUSD", displayName: "Euro vs US Dollar", assetType: "forex", baseCurrency: "EUR", quoteCurrency: "USD",
    pricePrecision: 5, minQty: "0.01", maxQty: "50", qtyStep: "0.01", tickSize: "0.00001", contractSize: "100000", enabled: true },
  { symbol: "BTCUSD", displayName: "Bitcoin vs US Dollar", assetType: "crypto", baseCurrency: "BTC", quoteCurrency: "USD",
    pricePrecision: 2, minQty: "0.01", maxQty: "10", qtyStep: "0.01", tickSize: "0.01", contractSize: "1", enabled: true },
];

export const DEFAULT_CONFIG: EngineConfig = { leverage: 100, commissionPerLotPerSide: "0", spreadMarkup: "0" };

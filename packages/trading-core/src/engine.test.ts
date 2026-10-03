import { describe, expect, it } from "vitest";
import {
  cancelOrder, closePosition, createAccount, modifyPosition, placeOrder, processQuote,
  resetAccount, summarize, suggestPositionSize, riskReward,
  type EngineContext, type EngineState, type Instrument, type Quote, TradingError,
} from "./index";

const XAU: Instrument = {
  symbol: "XAUUSD", displayName: "Gold vs US Dollar", assetType: "metal", baseCurrency: "XAU", quoteCurrency: "USD",
  pricePrecision: 2, minQty: "0.01", maxQty: "100", qtyStep: "0.01", tickSize: "0.01", contractSize: "100", enabled: true,
};
const quote = (bid: string, ask: string): Quote => ({ symbol: "XAUUSD", bid, ask, time: 0 });
let n = 0;
const ctx = (q: Quote, over: Partial<EngineContext["config"]> = {}): EngineContext => ({
  instruments: { XAUUSD: XAU }, quotes: { XAUUSD: q },
  config: { leverage: 100, commissionPerLotPerSide: "0", spreadMarkup: "0", ...over },
  now: 1000, newId: () => `id-${++n}`,
});
const fresh = (): EngineState => createAccount("10000", 0, "l0");
const buy = (s: EngineState, c: EngineContext, extra = {}) =>
  placeOrder(s, { symbol: "XAUUSD", side: "BUY", type: "MARKET", quantity: "0.10", ...extra }, c);

describe("market orders", () => {
  it("market buy fills at ask and opens a long", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")));
    expect(r.order?.executedPrice).toBe("2000.3");
    expect(r.state.positions).toHaveLength(1);
    expect(summarize(r.state, ctx(quote("2000.00", "2000.30"))).usedMargin).toBe("200.03");
  });
  it("market sell fills at bid and opens a short", () => {
    const r = placeOrder(fresh(), { symbol: "XAUUSD", side: "SELL", type: "MARKET", quantity: "0.10" }, ctx(quote("2000.00", "2000.30")));
    expect(r.order?.executedPrice).toBe("2000");
    expect(r.state.positions[0]?.side).toBe("SELL");
  });
  it("is idempotent for the same clientRequestId", () => {
    const c = ctx(quote("2000.00", "2000.30"));
    const a = buy(fresh(), c, { clientRequestId: "abc" });
    const b = buy(a.state, c, { clientRequestId: "abc" });
    expect(b.state.positions).toHaveLength(1);
  });
});

describe("P&L", () => {
  it("long unrealized P&L uses bid", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")));
    expect(summarize(r.state, ctx(quote("2002.00", "2002.30"))).unrealizedPnl).toBe("17");
  });
  it("short unrealized P&L uses ask", () => {
    const r = placeOrder(fresh(), { symbol: "XAUUSD", side: "SELL", type: "MARKET", quantity: "0.10" }, ctx(quote("2000.00", "2000.30")));
    expect(summarize(r.state, ctx(quote("1998.00", "1998.30"))).unrealizedPnl).toBe("17");
  });
  it("closing realizes P&L into balance", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")));
    const c = closePosition(r.state, r.state.positions[0]!.id, undefined, ctx(quote("2002.00", "2002.30")));
    expect(c.state.positions).toHaveLength(0);
    expect(c.state.balance).toBe("10017");
    expect(c.trade?.netPnl).toBe("17");
  });
});

describe("commission & spread", () => {
  it("charges commission on open and close", () => {
    const c0 = ctx(quote("2000.00", "2000.30"), { commissionPerLotPerSide: "3.5" });
    const r = buy(fresh(), c0);
    expect(r.state.balance).toBe("9999.65");
    const c = closePosition(r.state, r.state.positions[0]!.id, undefined, ctx(quote("2002.00", "2002.30"), { commissionPerLotPerSide: "3.5" }));
    expect(c.trade?.commission).toBe("0.7");
    expect(c.trade?.netPnl).toBe("16.3");
    expect(c.state.balance).toBe("10016.3");
  });
  it("applies spread markup", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30"), { spreadMarkup: "0.20" }));
    expect(r.order?.executedPrice).toBe("2000.4");
    expect(r.order?.spread).toBe("0.5");
  });
});

describe("stop-loss / take-profit", () => {
  it("triggers stop-loss on a long", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")), { stopLoss: "1995.00" });
    const p = processQuote(r.state, "XAUUSD", ctx(quote("1994.90", "1995.20")));
    expect(p.state.positions).toHaveLength(0);
    expect(p.state.trades[0]?.closeReason).toBe("STOP_LOSS");
    expect(p.state.trades[0]?.grossPnl).toBe("-54");
    expect(p.events[0]?.type).toBe("STOP_LOSS_TRIGGERED");
  });
  it("triggers take-profit on a long", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")), { takeProfit: "2005.00" });
    const p = processQuote(r.state, "XAUUSD", ctx(quote("2005.10", "2005.40")));
    expect(p.state.trades[0]?.closeReason).toBe("TAKE_PROFIT");
    expect(p.state.trades[0]?.grossPnl).toBe("48");
  });
  it("triggers stop-loss and take-profit on a short", () => {
    const sell = (x = {}) => placeOrder(fresh(), { symbol: "XAUUSD", side: "SELL", type: "MARKET", quantity: "0.10", ...x }, ctx(quote("2000.00", "2000.30")));
    const sl = processQuote(sell({ stopLoss: "2005.00" }).state, "XAUUSD", ctx(quote("2004.80", "2005.00")));
    expect(sl.state.trades[0]?.closeReason).toBe("STOP_LOSS");
    const tp = processQuote(sell({ takeProfit: "1995.00" }).state, "XAUUSD", ctx(quote("1994.70", "1995.00")));
    expect(tp.state.trades[0]?.closeReason).toBe("TAKE_PROFIT");
  });
  it("rejects SL/TP on the wrong side and supports modification", () => {
    expect(() => buy(fresh(), ctx(quote("2000.00", "2000.30")), { stopLoss: "2010" })).toThrow(TradingError);
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")));
    const m = modifyPosition(r.state, r.state.positions[0]!.id, { stopLoss: "1990.00", takeProfit: "2020.00" }, ctx(quote("2000.00", "2000.30")));
    expect(m.state.positions[0]?.stopLoss).toBe("1990");
  });
});

describe("pending orders", () => {
  it("fills a buy limit when ask reaches the price", () => {
    const r = placeOrder(fresh(), { symbol: "XAUUSD", side: "BUY", type: "LIMIT", quantity: "0.10", price: "1990.00" }, ctx(quote("2000.00", "2000.30")));
    expect(r.order?.status).toBe("PENDING");
    const p = processQuote(r.state, "XAUUSD", ctx(quote("1989.60", "1989.90")));
    expect(p.state.positions[0]?.entryPrice).toBe("1989.9");
    expect(p.state.orders[0]?.status).toBe("FILLED");
  });
  it("fills a buy stop when ask rises through the price", () => {
    const r = placeOrder(fresh(), { symbol: "XAUUSD", side: "BUY", type: "STOP", quantity: "0.10", price: "2010.00" }, ctx(quote("2000.00", "2000.30")));
    expect(processQuote(r.state, "XAUUSD", ctx(quote("2005", "2005.3"))).state.positions).toHaveLength(0);
    const p = processQuote(r.state, "XAUUSD", ctx(quote("2010.20", "2010.50")));
    expect(p.state.positions[0]?.entryPrice).toBe("2010.5");
  });
  it("rejects a limit order on the wrong side of the market", () => {
    expect(() => placeOrder(fresh(), { symbol: "XAUUSD", side: "BUY", type: "LIMIT", quantity: "0.1", price: "2100" }, ctx(quote("2000.00", "2000.30")))).toThrow(/wrong side/);
  });
  it("cancels a pending order but not a filled one", () => {
    const c = ctx(quote("2000.00", "2000.30"));
    const r = placeOrder(fresh(), { symbol: "XAUUSD", side: "BUY", type: "LIMIT", quantity: "0.10", price: "1990.00" }, c);
    expect(cancelOrder(r.state, r.order!.id, c).state.orders[0]?.status).toBe("CANCELLED");
    const f = buy(fresh(), c);
    expect(() => cancelOrder(f.state, f.order!.id, c)).toThrow(TradingError);
  });
});

describe("closing", () => {
  it("partially closes and keeps the remainder", () => {
    const r = buy(fresh(), ctx(quote("2000.00", "2000.30")), { quantity: "0.10" });
    const c = closePosition(r.state, r.state.positions[0]!.id, "0.04", ctx(quote("2002.00", "2002.30")));
    expect(c.state.positions[0]?.quantity).toBe("0.06");
    expect(c.trade?.grossPnl).toBe("6.8");
    expect(() => closePosition(c.state, c.state.positions[0]!.id, "0.50", ctx(quote("2002.00", "2002.30")))).toThrow(/more than/);
  });
});

describe("validation", () => {
  const c = ctx(quote("2000.00", "2000.30"));
  const bad = (q: unknown) => () => buy(fresh(), c, { quantity: q });
  it("rejects invalid quantities", () => {
    for (const q of [0, -1, "-0.5", NaN, Infinity, "abc", "", null, 1e30, "0.001", "0.015", "1000"]) expect(bad(q)).toThrow(TradingError);
  });
  it("rejects invalid symbols and disabled instruments", () => {
    expect(() => placeOrder(fresh(), { symbol: "FAKE", side: "BUY", type: "MARKET", quantity: "1" }, c)).toThrow(/Unknown symbol/);
    const off = { ...c, instruments: { XAUUSD: { ...XAU, enabled: false } } };
    expect(() => buy(fresh(), off)).toThrow(/disabled/);
  });
  it("rejects negative / extreme prices", () => {
    expect(() => buy(fresh(), c, { stopLoss: "-5" })).toThrow(TradingError);
    expect(() => buy(fresh(), c, { takeProfit: "1e20" })).toThrow(TradingError);
  });
  it("rejects orders exceeding free margin", () => {
    expect(() => buy(fresh(), c, { quantity: "100" })).toThrow(/INSUFFICIENT|margin/i);
    try { buy(fresh(), c, { quantity: "100" }); } catch (e) { expect((e as TradingError).code).toBe("INSUFFICIENT_FUNDS"); }
  });
});

describe("account reset", () => {
  it("closes positions, cancels orders and restores the balance", () => {
    const c = ctx(quote("2000.00", "2000.30"));
    let s = buy(fresh(), c).state;
    s = placeOrder(s, { symbol: "XAUUSD", side: "BUY", type: "LIMIT", quantity: "0.1", price: "1990" }, c).state;
    s = closePosition(s, s.positions[0]!.id, "0.05", ctx(quote("1990.00", "1990.30"))).state; // realize a loss
    const r = resetAccount(s, c);
    expect(r.state.positions).toHaveLength(0);
    expect(r.state.balance).toBe("10000");
    expect(r.state.orders.every((o) => o.status !== "PENDING")).toBe(true);
  });
});

describe("risk calculators", () => {
  it("sizes a position from risk %", () => {
    const r = suggestPositionSize({ balance: 10000, riskPercent: 1, entry: 2000, stopLoss: 1990, instrument: XAU });
    expect(r.maxRiskAmount).toBe("100");
    expect(r.suggestedSize).toBe("0.1");
  });
  it("computes risk/reward", () => {
    const r = riskReward({ balance: 10000, entry: 2000, stopLoss: 1990, takeProfit: 2020, quantity: 0.1, instrument: XAU });
    expect(r.ratio).toBe("2");
    expect(r.potentialLoss).toBe("100");
  });
});

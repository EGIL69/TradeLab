import {
  D, Decimal, TradingError, optionalDecimal, parseDecimal, roundMoney, str,
} from "./decimal";
import type {
  AccountSummary, CloseReason, EngineContext, EngineEvent, EngineResult, EngineState,
  Instrument, LedgerEntry, Order, OrderRequest, Position, Quote, Side, Trade,
} from "./types";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export function createAccount(startingBalance: unknown = "10000", now = Date.now(), id = "ledger-initial"): EngineState {
  const start = parseDecimal(startingBalance, "startingBalance");
  if (start.lte(0)) throw new TradingError("INVALID_NUMBER", "startingBalance must be positive");
  return {
    startingBalance: str(start), balance: str(start),
    positions: [], orders: [], trades: [],
    ledger: [{ id, type: "INITIAL", amount: str(start), balanceAfter: str(start), refId: null, createdAt: now }],
  };
}

/* ------------------------------------------------------------------ */
/* Pricing helpers                                                     */
/* ------------------------------------------------------------------ */

/** Quote with the configured spread markup applied (half on each side). */
export function effectiveQuote(q: Quote, markup: string): { bid: Decimal; ask: Decimal } {
  const half = D(markup).div(2);
  return { bid: D(q.bid).minus(half), ask: D(q.ask).plus(half) };
}

function getQuote(ctx: EngineContext, symbol: string) {
  const q = ctx.quotes[symbol];
  if (!q) throw new TradingError("NO_QUOTE", `No quote available for ${symbol}`);
  const eq = effectiveQuote(q, ctx.config.spreadMarkup);
  if (eq.bid.lte(0) || eq.ask.lte(0) || eq.ask.lt(eq.bid)) throw new TradingError("NO_QUOTE", `Invalid quote for ${symbol}`);
  return eq;
}

function getInstrument(ctx: EngineContext, symbol: unknown): Instrument {
  const inst = typeof symbol === "string" ? ctx.instruments[symbol] : undefined;
  if (!inst) throw new TradingError("UNKNOWN_SYMBOL", `Unknown symbol: ${String(symbol)}`);
  if (!inst.enabled) throw new TradingError("INSTRUMENT_DISABLED", `${inst.symbol} is disabled`);
  return inst;
}

/** USD value of one unit of the instrument's quote currency. */
function quoteRate(inst: Instrument, ctx: EngineContext): Decimal {
  if (inst.quoteCurrency === "USD") return D(1);
  const r = ctx.conversionRates?.[inst.quoteCurrency];
  if (!r) throw new TradingError("MISSING_CONVERSION_RATE", `Missing USD rate for ${inst.quoteCurrency}`);
  return D(r);
}

/** Required margin in USD: notional / leverage. */
export function requiredMargin(inst: Instrument, qty: Decimal, price: Decimal, ctx: EngineContext): Decimal {
  const units = qty.times(inst.contractSize);
  const notionalUsd = inst.baseCurrency === "USD" ? units : units.times(price).times(quoteRate(inst, ctx));
  return notionalUsd.div(ctx.config.leverage);
}

const dir = (side: Side): Decimal => D(side === "BUY" ? 1 : -1);
const exitPriceFor = (side: Side, q: { bid: Decimal; ask: Decimal }) => (side === "BUY" ? q.bid : q.ask);

/** P&L (USD) of `qty` of a position if closed at `exit`. */
export function pnlAt(inst: Instrument, side: Side, entry: Decimal, exit: Decimal, qty: Decimal, ctx: EngineContext): Decimal {
  return exit.minus(entry).times(dir(side)).times(qty).times(inst.contractSize).times(quoteRate(inst, ctx));
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export function summarize(state: EngineState, ctx: EngineContext): AccountSummary {
  let unrealized = D(0);
  let used = D(0);
  for (const p of state.positions) {
    const inst = ctx.instruments[p.symbol];
    if (!inst) continue;
    const q = ctx.quotes[p.symbol] ? getQuote(ctx, p.symbol) : null;
    const entry = D(p.entryPrice);
    const exit = q ? exitPriceFor(p.side, q) : entry;
    unrealized = unrealized.plus(pnlAt(inst, p.side, entry, exit, D(p.quantity), ctx));
    used = used.plus(requiredMargin(inst, D(p.quantity), entry, ctx));
  }
  const balance = D(state.balance);
  const equity = balance.plus(unrealized);
  const realized = state.trades.reduce((s, t) => s.plus(t.netPnl), D(0));
  return {
    balance: str(roundMoney(balance)), equity: str(roundMoney(equity)),
    usedMargin: str(roundMoney(used)), freeMargin: str(roundMoney(equity.minus(used))),
    marginLevel: used.gt(0) ? str(equity.div(used).times(100).toDecimalPlaces(2)) : null,
    unrealizedPnl: str(roundMoney(unrealized)), realizedPnl: str(roundMoney(realized)),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function validateQuantity(inst: Instrument, raw: unknown): Decimal {
  const qty = parseDecimal(raw, "quantity");
  if (qty.lte(0)) throw new TradingError("INVALID_QUANTITY", "Quantity must be greater than zero");
  if (qty.lt(inst.minQty)) throw new TradingError("INVALID_QUANTITY", `Minimum quantity is ${inst.minQty}`);
  if (qty.gt(inst.maxQty)) throw new TradingError("INVALID_QUANTITY", `Maximum quantity is ${inst.maxQty}`);
  if (!qty.mod(inst.qtyStep).isZero()) throw new TradingError("INVALID_QUANTITY", `Quantity must be a multiple of ${inst.qtyStep}`);
  return qty;
}

function validatePrice(inst: Instrument, raw: unknown, field: string, code: "INVALID_PRICE" | "INVALID_STOP_LOSS" | "INVALID_TAKE_PROFIT"): Decimal | null {
  const p = optionalDecimal(raw, field);
  if (p === null) return null;
  if (p.lte(0)) throw new TradingError(code, `${field} must be greater than zero`);
  if (p.decimalPlaces() > inst.pricePrecision) throw new TradingError(code, `${field} allows at most ${inst.pricePrecision} decimals`);
  return p;
}

function validateLevels(side: Side, ref: Decimal, sl: Decimal | null, tp: Decimal | null) {
  if (sl && (side === "BUY" ? sl.gte(ref) : sl.lte(ref)))
    throw new TradingError("INVALID_STOP_LOSS", `Stop-loss must be ${side === "BUY" ? "below" : "above"} ${str(ref)}`);
  if (tp && (side === "BUY" ? tp.lte(ref) : tp.gte(ref)))
    throw new TradingError("INVALID_TAKE_PROFIT", `Take-profit must be ${side === "BUY" ? "above" : "below"} ${str(ref)}`);
}

/* ------------------------------------------------------------------ */
/* Internal state helpers                                              */
/* ------------------------------------------------------------------ */

function addLedger(state: EngineState, ctx: EngineContext, type: LedgerEntry["type"], amount: Decimal, refId: string | null): EngineState {
  if (amount.isZero() && type !== "RESET") return state;
  const balance = D(state.balance).plus(amount);
  const entry: LedgerEntry = { id: ctx.newId(), type, amount: str(amount), balanceAfter: str(balance), refId, createdAt: ctx.now };
  return { ...state, balance: str(balance), ledger: [...state.ledger, entry] };
}

const replaceOrder = (s: EngineState, o: Order): EngineState => ({ ...s, orders: s.orders.map((x) => (x.id === o.id ? o : x)) });

/** Opens a position for `order` at `price`. Caller has validated everything except margin. */
function fillOrder(state: EngineState, order: Order, price: Decimal, ctx: EngineContext, isNew: boolean): { state: EngineState; order: Order; events: EngineEvent[] } {
  const inst = getInstrument(ctx, order.symbol);
  const qty = D(order.quantity);
  const summary = summarize(state, ctx);
  const margin = requiredMargin(inst, qty, price, ctx);
  if (margin.gt(summary.freeMargin)) {
    throw new TradingError("INSUFFICIENT_FUNDS", `Required margin ${str(roundMoney(margin))} exceeds free margin ${summary.freeMargin}`);
  }
  const q = getQuote(ctx, order.symbol);
  const commission = roundMoney(qty.times(ctx.config.commissionPerLotPerSide));
  const spread = q.ask.minus(q.bid);
  const spreadCost = roundMoney(spread.times(qty).times(inst.contractSize).times(quoteRate(inst, ctx)));
  const position: Position = {
    id: ctx.newId(), orderId: order.id, symbol: order.symbol, side: order.side,
    quantity: order.quantity, entryPrice: str(price),
    stopLoss: order.stopLoss, takeProfit: order.takeProfit,
    openCommission: str(commission), spreadCost: str(spreadCost), openedAt: ctx.now,
  };
  const filled: Order = {
    ...order, status: "FILLED", executedPrice: str(price), executedAt: ctx.now, updatedAt: ctx.now,
    commission: str(commission), spread: str(spread),
  };
  let next: EngineState = { ...state, positions: [...state.positions, position] };
  next = isNew ? { ...next, orders: [...next.orders, filled] } : replaceOrder(next, filled);
  next = addLedger(next, ctx, "COMMISSION", commission.neg(), order.id);
  return {
    state: next, order: filled,
    events: [{ type: isNew ? "ORDER_FILLED" : "PENDING_TRIGGERED", refId: order.id,
      message: `${order.side} ${order.quantity} ${order.symbol} @ ${str(price)}` }],
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function placeOrder(state: EngineState, req: OrderRequest, ctx: EngineContext): EngineResult {
  if (req.clientRequestId) {
    const existing = state.orders.find((o) => o.clientRequestId === req.clientRequestId);
    if (existing) return { state, events: [], order: existing }; // idempotent replay
  }
  const inst = getInstrument(ctx, req.symbol);
  if (req.side !== "BUY" && req.side !== "SELL") throw new TradingError("INVALID_STATE", "Side must be BUY or SELL");
  if (!["MARKET", "LIMIT", "STOP"].includes(req.type)) throw new TradingError("INVALID_STATE", "Invalid order type");
  const qty = validateQuantity(inst, req.quantity);
  const sl = validatePrice(inst, req.stopLoss, "stopLoss", "INVALID_STOP_LOSS");
  const tp = validatePrice(inst, req.takeProfit, "takeProfit", "INVALID_TAKE_PROFIT");
  const q = getQuote(ctx, inst.symbol);
  const marketPrice = req.side === "BUY" ? q.ask : q.bid;

  let requested: Decimal | null = null;
  if (req.type !== "MARKET") {
    requested = validatePrice(inst, req.price, "price", "INVALID_PRICE");
    if (!requested) throw new TradingError("INVALID_PRICE", "Price is required for pending orders");
    const ok =
      (req.type === "LIMIT" && req.side === "BUY" && requested.lt(q.ask)) ||
      (req.type === "LIMIT" && req.side === "SELL" && requested.gt(q.bid)) ||
      (req.type === "STOP" && req.side === "BUY" && requested.gt(q.ask)) ||
      (req.type === "STOP" && req.side === "SELL" && requested.lt(q.bid));
    if (!ok) throw new TradingError("INVALID_PRICE", `${req.type} ${req.side} price is on the wrong side of the market`);
  }
  validateLevels(req.side, requested ?? marketPrice, sl, tp);

  const order: Order = {
    id: ctx.newId(), clientRequestId: req.clientRequestId ?? null, symbol: inst.symbol,
    side: req.side, type: req.type, quantity: str(qty),
    requestedPrice: requested ? str(requested) : null, executedPrice: null,
    stopLoss: sl ? str(sl) : null, takeProfit: tp ? str(tp) : null,
    status: "PENDING", createdAt: ctx.now, updatedAt: ctx.now, executedAt: null,
    commission: "0", spread: "0", realizedPnl: "0", metadata: req.metadata ?? {},
  };

  if (req.type !== "MARKET") {
    return {
      state: { ...state, orders: [...state.orders, order] }, order,
      events: [{ type: "ORDER_PENDING", refId: order.id, message: `${req.type} ${req.side} ${str(qty)} ${inst.symbol} @ ${str(requested!)}` }],
    };
  }
  const r = fillOrder(state, order, marketPrice, ctx, true);
  return { state: r.state, order: r.order, events: r.events };
}

export function cancelOrder(state: EngineState, orderId: string, ctx: EngineContext): EngineResult {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) throw new TradingError("NOT_FOUND", "Order not found");
  if (o.status !== "PENDING") throw new TradingError("INVALID_STATE", "Only pending orders can be cancelled");
  const cancelled: Order = { ...o, status: "CANCELLED", updatedAt: ctx.now };
  return { state: replaceOrder(state, cancelled), order: cancelled, events: [{ type: "ORDER_CANCELLED", refId: o.id, message: `Cancelled ${o.type} order` }] };
}

export function modifyOrder(state: EngineState, orderId: string, changes: { price?: unknown; stopLoss?: unknown; takeProfit?: unknown }, ctx: EngineContext): EngineResult {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) throw new TradingError("NOT_FOUND", "Order not found");
  if (o.status !== "PENDING") throw new TradingError("INVALID_STATE", "Only pending orders can be modified");
  const inst = getInstrument(ctx, o.symbol);
  const q = getQuote(ctx, o.symbol);
  const price = "price" in changes ? validatePrice(inst, changes.price, "price", "INVALID_PRICE") : D(o.requestedPrice!);
  if (!price) throw new TradingError("INVALID_PRICE", "Price is required");
  const ok =
    (o.type === "LIMIT" && o.side === "BUY" && price.lt(q.ask)) || (o.type === "LIMIT" && o.side === "SELL" && price.gt(q.bid)) ||
    (o.type === "STOP" && o.side === "BUY" && price.gt(q.ask)) || (o.type === "STOP" && o.side === "SELL" && price.lt(q.bid));
  if (!ok) throw new TradingError("INVALID_PRICE", "Price is on the wrong side of the market");
  const sl = "stopLoss" in changes ? validatePrice(inst, changes.stopLoss, "stopLoss", "INVALID_STOP_LOSS") : optionalDecimal(o.stopLoss, "stopLoss");
  const tp = "takeProfit" in changes ? validatePrice(inst, changes.takeProfit, "takeProfit", "INVALID_TAKE_PROFIT") : optionalDecimal(o.takeProfit, "takeProfit");
  validateLevels(o.side, price, sl, tp);
  const updated: Order = { ...o, requestedPrice: str(price), stopLoss: sl ? str(sl) : null, takeProfit: tp ? str(tp) : null, updatedAt: ctx.now };
  return { state: replaceOrder(state, updated), order: updated, events: [] };
}

export function modifyPosition(state: EngineState, positionId: string, changes: { stopLoss?: unknown; takeProfit?: unknown }, ctx: EngineContext): EngineResult {
  const p = state.positions.find((x) => x.id === positionId);
  if (!p) throw new TradingError("NOT_FOUND", "Position not found");
  const inst = getInstrument(ctx, p.symbol);
  const q = getQuote(ctx, p.symbol);
  const sl = "stopLoss" in changes ? validatePrice(inst, changes.stopLoss, "stopLoss", "INVALID_STOP_LOSS") : optionalDecimal(p.stopLoss, "stopLoss");
  const tp = "takeProfit" in changes ? validatePrice(inst, changes.takeProfit, "takeProfit", "INVALID_TAKE_PROFIT") : optionalDecimal(p.takeProfit, "takeProfit");
  validateLevels(p.side, exitPriceFor(p.side, q), sl, tp); // validated against the current exit price
  const updated: Position = { ...p, stopLoss: sl ? str(sl) : null, takeProfit: tp ? str(tp) : null };
  return { state: { ...state, positions: state.positions.map((x) => (x.id === p.id ? updated : x)) }, events: [] };
}

/** Closes all or part of a position at the current exit price. */
export function closePosition(state: EngineState, positionId: string, quantity: unknown | undefined, ctx: EngineContext, reason: CloseReason = "MANUAL"): EngineResult {
  const p = state.positions.find((x) => x.id === positionId);
  if (!p) throw new TradingError("NOT_FOUND", "Position not found");
  const inst = getInstrument(ctx, p.symbol);
  const full = D(p.quantity);
  const qty = quantity === undefined ? full : validateQuantity(inst, quantity);
  if (qty.gt(full)) throw new TradingError("INVALID_QUANTITY", "Cannot close more than the open quantity");

  const exit = exitPriceFor(p.side, getQuote(ctx, p.symbol));
  const portion = qty.div(full);
  const gross = roundMoney(pnlAt(inst, p.side, D(p.entryPrice), exit, qty, ctx));
  const closeCommission = roundMoney(qty.times(ctx.config.commissionPerLotPerSide));
  const openShare = roundMoney(D(p.openCommission).times(portion));
  const spreadShare = roundMoney(D(p.spreadCost).times(portion));
  const commission = openShare.plus(closeCommission);
  const net = gross.minus(commission); // open commission was already debited at entry

  const trade: Trade = {
    id: ctx.newId(), positionId: p.id, symbol: p.symbol, side: p.side, quantity: str(qty),
    entryPrice: p.entryPrice, exitPrice: str(exit), grossPnl: str(gross), commission: str(commission),
    spreadCost: str(spreadShare), netPnl: str(net), openedAt: p.openedAt, closedAt: ctx.now, closeReason: reason,
  };

  let next: EngineState = { ...state, trades: [...state.trades, trade] };
  next = addLedger(next, ctx, "TRADE_PNL", gross, trade.id);
  next = addLedger(next, ctx, "COMMISSION", closeCommission.neg(), trade.id);

  const remaining = full.minus(qty);
  next = {
    ...next,
    positions: remaining.isZero()
      ? next.positions.filter((x) => x.id !== p.id)
      : next.positions.map((x) => x.id === p.id
          ? { ...x, quantity: str(remaining), openCommission: str(D(x.openCommission).minus(openShare)), spreadCost: str(D(x.spreadCost).minus(spreadShare)) }
          : x),
    orders: next.orders.map((o) => (o.id === p.orderId ? { ...o, realizedPnl: str(D(o.realizedPnl).plus(net)), updatedAt: ctx.now } : o)),
  };
  const evType = reason === "STOP_LOSS" ? "STOP_LOSS_TRIGGERED" : reason === "TAKE_PROFIT" ? "TAKE_PROFIT_TRIGGERED" : "POSITION_CLOSED";
  return { state: next, trade, events: [{ type: evType, refId: p.id, message: `${p.symbol} closed @ ${str(exit)} (net ${str(net)})` }] };
}

/**
 * Evaluate a fresh quote: fill triggered pending orders, then check SL/TP.
 * Fills use the current executable side of the quote (so gaps can fill worse
 * than the trigger level), except limit orders which never fill worse than their price.
 */
export function processQuote(state: EngineState, symbol: string, ctx: EngineContext): EngineResult {
  const events: EngineEvent[] = [];
  let s = state;
  if (!ctx.quotes[symbol]) return { state, events };
  const q = getQuote(ctx, symbol);

  for (const o of s.orders.filter((x) => x.status === "PENDING" && x.symbol === symbol)) {
    const target = D(o.requestedPrice!);
    let fillPrice: Decimal | null = null;
    if (o.type === "LIMIT" && o.side === "BUY" && q.ask.lte(target)) fillPrice = Decimal.min(target, q.ask);
    if (o.type === "LIMIT" && o.side === "SELL" && q.bid.gte(target)) fillPrice = Decimal.max(target, q.bid);
    if (o.type === "STOP" && o.side === "BUY" && q.ask.gte(target)) fillPrice = q.ask;
    if (o.type === "STOP" && o.side === "SELL" && q.bid.lte(target)) fillPrice = q.bid;
    if (!fillPrice) continue;
    try {
      const r = fillOrder(s, o, fillPrice, ctx, false);
      s = r.state; events.push(...r.events);
    } catch (e) {
      if (!(e instanceof TradingError) || e.code !== "INSUFFICIENT_FUNDS") throw e;
      s = replaceOrder(s, { ...o, status: "CANCELLED", updatedAt: ctx.now, metadata: { ...o.metadata, cancelReason: e.message } });
      events.push({ type: "ORDER_CANCELLED", refId: o.id, message: `Pending order cancelled: ${e.message}` });
    }
  }

  for (const p of s.positions.filter((x) => x.symbol === symbol)) {
    const exit = exitPriceFor(p.side, q);
    const long = p.side === "BUY";
    let reason: CloseReason | null = null;
    if (p.stopLoss && (long ? exit.lte(p.stopLoss) : exit.gte(p.stopLoss))) reason = "STOP_LOSS";
    else if (p.takeProfit && (long ? exit.gte(p.takeProfit) : exit.lte(p.takeProfit))) reason = "TAKE_PROFIT";
    if (!reason) continue;
    const r = closePosition(s, p.id, undefined, ctx, reason);
    s = r.state; events.push(...r.events);
  }
  return { state: s, events };
}

/** Closes every position and cancels pending orders, then restores the starting balance. History is kept. */
export function resetAccount(state: EngineState, ctx: EngineContext): EngineResult {
  const cancelled = state.orders.map((o) => (o.status === "PENDING" ? { ...o, status: "CANCELLED" as const, updatedAt: ctx.now } : o));
  const delta = D(state.startingBalance).minus(state.balance);
  let next: EngineState = { ...state, positions: [], orders: cancelled };
  next = addLedger(next, ctx, "RESET", delta, null);
  return { state: next, events: [{ type: "ACCOUNT_RESET", refId: "account", message: "Demo account reset" }] };
}

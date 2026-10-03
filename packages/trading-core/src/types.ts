export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
export type CloseReason = "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT";

/** All money/price/quantity values are decimal STRINGS to avoid float drift. */
export interface Instrument {
  symbol: string;
  displayName: string;
  assetType: "forex" | "metal" | "crypto" | "index";
  baseCurrency: string;
  quoteCurrency: string;
  pricePrecision: number;
  minQty: string;
  maxQty: string;
  qtyStep: string;
  tickSize: string;
  contractSize: string;
  enabled: boolean;
}

export interface Quote { symbol: string; bid: string; ask: string; time: number }

export interface EngineConfig {
  leverage: number;
  /** Commission charged per lot, per side (open and close). Account currency. */
  commissionPerLotPerSide: string;
  /** Extra spread in price units added on top of the feed (split half/half). */
  spreadMarkup: string;
}

export interface Position {
  id: string; orderId: string; symbol: string; side: Side;
  quantity: string; entryPrice: string;
  stopLoss: string | null; takeProfit: string | null;
  openCommission: string; spreadCost: string; openedAt: number;
}

export interface Order {
  id: string; clientRequestId: string | null; symbol: string; side: Side;
  type: OrderType; quantity: string; requestedPrice: string | null;
  executedPrice: string | null; stopLoss: string | null; takeProfit: string | null;
  status: OrderStatus; createdAt: number; updatedAt: number; executedAt: number | null;
  commission: string; spread: string; realizedPnl: string;
  metadata: Record<string, unknown>;
}

export interface Trade {
  id: string; positionId: string; symbol: string; side: Side; quantity: string;
  entryPrice: string; exitPrice: string; grossPnl: string; commission: string;
  spreadCost: string; netPnl: string; openedAt: number; closedAt: number;
  closeReason: CloseReason;
}

export interface LedgerEntry {
  id: string; type: "INITIAL" | "COMMISSION" | "TRADE_PNL" | "RESET";
  amount: string; balanceAfter: string; refId: string | null; createdAt: number;
}

export interface EngineState {
  startingBalance: string; balance: string;
  positions: Position[]; orders: Order[]; trades: Trade[]; ledger: LedgerEntry[];
}

export interface EngineContext {
  instruments: Record<string, Instrument>;
  quotes: Record<string, Quote>;
  config: EngineConfig;
  now: number;
  newId: () => string;
  /** Units of USD per 1 unit of a currency. Needed when quote currency != USD. */
  conversionRates?: Record<string, string>;
}

export interface OrderRequest {
  clientRequestId?: string;
  symbol: string; side: Side; type: OrderType;
  quantity: unknown; price?: unknown; stopLoss?: unknown; takeProfit?: unknown;
  metadata?: Record<string, unknown>;
}

export type EngineEventType =
  | "ORDER_FILLED" | "ORDER_PENDING" | "ORDER_CANCELLED" | "PENDING_TRIGGERED"
  | "STOP_LOSS_TRIGGERED" | "TAKE_PROFIT_TRIGGERED" | "POSITION_CLOSED" | "ACCOUNT_RESET";

export interface EngineEvent { type: EngineEventType; refId: string; message: string }
export interface EngineResult { state: EngineState; events: EngineEvent[]; order?: Order; trade?: Trade }

export interface AccountSummary {
  balance: string; equity: string; usedMargin: string; freeMargin: string;
  marginLevel: string | null; unrealizedPnl: string; realizedPnl: string;
}

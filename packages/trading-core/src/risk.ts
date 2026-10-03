import { D, Decimal, TradingError, parseDecimal, str } from "./decimal";
import type { Instrument } from "./types";

/** Educational calculator only. Not financial advice. */
export function suggestPositionSize(i: { balance: unknown; riskPercent: unknown; entry: unknown; stopLoss: unknown; instrument: Instrument; quoteToUsd?: string }) {
  const balance = parseDecimal(i.balance, "balance");
  const pct = parseDecimal(i.riskPercent, "riskPercent");
  const entry = parseDecimal(i.entry, "entry");
  const sl = parseDecimal(i.stopLoss, "stopLoss");
  if (balance.lte(0) || pct.lte(0) || pct.gt(100)) throw new TradingError("INVALID_NUMBER", "Balance and risk % must be positive (risk <= 100)");
  const distance = entry.minus(sl).abs();
  if (distance.isZero()) throw new TradingError("INVALID_STOP_LOSS", "Stop-loss must differ from entry");
  const riskAmount = balance.times(pct).div(100);
  const perLot = distance.times(i.instrument.contractSize).times(i.quoteToUsd ?? (i.instrument.quoteCurrency === "USD" ? "1" : "NaN"));
  if (!perLot.isFinite()) throw new TradingError("MISSING_CONVERSION_RATE", "Provide quoteToUsd for this instrument");
  const raw = riskAmount.div(perLot);
  const step = D(i.instrument.qtyStep);
  let size = raw.div(step).floor().times(step);
  size = Decimal.min(size, i.instrument.maxQty);
  return { maxRiskAmount: str(riskAmount.toDecimalPlaces(2)), stopDistance: str(distance), suggestedSize: str(size), belowMinimum: size.lt(i.instrument.minQty) };
}

export function riskReward(i: { balance: unknown; entry: unknown; stopLoss: unknown; takeProfit: unknown; quantity: unknown; instrument: Instrument }) {
  const balance = parseDecimal(i.balance, "balance");
  const entry = parseDecimal(i.entry, "entry");
  const sl = parseDecimal(i.stopLoss, "stopLoss");
  const tp = parseDecimal(i.takeProfit, "takeProfit");
  const qty = parseDecimal(i.quantity, "quantity");
  if (balance.lte(0)) throw new TradingError("INVALID_NUMBER", "Balance must be positive");
  const unit = qty.times(i.instrument.contractSize);
  const loss = entry.minus(sl).abs().times(unit);
  const profit = tp.minus(entry).abs().times(unit);
  return {
    potentialLoss: str(loss.toDecimalPlaces(2)), potentialProfit: str(profit.toDecimalPlaces(2)),
    riskPercent: str(loss.div(balance).times(100).toDecimalPlaces(2)),
    rewardPercent: str(profit.div(balance).times(100).toDecimalPlaces(2)),
    ratio: loss.isZero() ? null : str(profit.div(loss).toDecimalPlaces(2)),
    breakEvenNote: "Break-even is the entry price plus the spread and commissions on a long (minus them on a short).",
  };
}

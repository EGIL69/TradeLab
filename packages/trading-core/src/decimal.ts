import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export const D = (v: Decimal.Value): Decimal => new Decimal(v);
const MAX_ABS = new Decimal("1e12");

export type TradingErrorCode =
  | "INVALID_NUMBER" | "VALUE_OUT_OF_RANGE" | "UNKNOWN_SYMBOL" | "INSTRUMENT_DISABLED"
  | "INVALID_QUANTITY" | "INVALID_PRICE" | "INVALID_STOP_LOSS" | "INVALID_TAKE_PROFIT"
  | "NO_QUOTE" | "INSUFFICIENT_FUNDS" | "NOT_FOUND" | "INVALID_STATE" | "MISSING_CONVERSION_RATE";

export class TradingError extends Error {
  constructor(public code: TradingErrorCode, message: string) {
    super(message);
    this.name = "TradingError";
  }
}

/** Parses untrusted input into a finite, bounded Decimal or throws. */
export function parseDecimal(v: unknown, field: string): Decimal {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TradingError("INVALID_NUMBER", `${field} must be a finite number`);
  } else if (typeof v !== "string" || v.trim() === "") {
    throw new TradingError("INVALID_NUMBER", `${field} must be a number`);
  }
  let d: Decimal;
  try { d = new Decimal(v as string | number); }
  catch { throw new TradingError("INVALID_NUMBER", `${field} is not a valid number`); }
  if (!d.isFinite()) throw new TradingError("INVALID_NUMBER", `${field} must be finite`);
  if (d.abs().gt(MAX_ABS)) throw new TradingError("VALUE_OUT_OF_RANGE", `${field} is out of range`);
  return d;
}

export const optionalDecimal = (v: unknown, field: string): Decimal | null =>
  v === undefined || v === null || v === "" ? null : parseDecimal(v, field);

/** Money is rounded to cents using banker's rounding. */
export const roundMoney = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
export const str = (d: Decimal): string => d.toFixed();

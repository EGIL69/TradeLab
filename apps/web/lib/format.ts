import type { Instrument } from "@tlp/trading-core";

export const fmtPrice = (v: string | number | null | undefined, inst?: Pick<Instrument, "pricePrecision">): string => {
  if (v === null || v === undefined || v === "") return "–";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(inst?.pricePrecision ?? 2) : "–";
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
export const fmtMoney = (v: string | number): string => money.format(Number(v));
export const fmtSigned = (v: string | number): string => {
  const n = Number(v);
  return (n > 0 ? "+" : "") + money.format(n);
};
export const tone = (v: string | number): "up" | "down" | "flat" => (Number(v) > 0 ? "up" : Number(v) < 0 ? "down" : "flat");
export const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

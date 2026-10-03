"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAME_SECONDS, type Candle, type Timeframe } from "@tlp/market-data";
import { provider } from "../lib/provider";

export interface ChartLevel { price: number; color: string; title: string; dashed?: boolean }
interface Props { symbol: string; timeframe: Timeframe; precision: number; mid: number | null; levels: ChartLevel[] }

const UP = "#34c28e";
const DOWN = "#f0646a";

export default function Chart({ symbol, timeframe, precision, mid, levels }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const last = useRef<Candle | null>(null);
  const lines = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8493a6", fontFamily: "inherit", attributionLogo: true },
      grid: { vertLines: { color: "rgba(36,49,66,0.55)" }, horzLines: { color: "rgba(36,49,66,0.55)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#243142" },
      timeScale: { borderColor: "#243142", timeVisible: true, secondsVisible: false },
    });
    candles.current = c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => { c.remove(); chart.current = null; candles.current = null; volume.current = null; lines.current = []; };
  }, []);

  // Load history when the symbol or timeframe changes.
  useEffect(() => {
    let cancelled = false;
    last.current = null;
    candles.current?.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    provider.getHistoricalCandles(symbol, timeframe, 300).then((data) => {
      if (cancelled || !candles.current || !volume.current) return;
      candles.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, open: d.open, high: d.high, low: d.low, close: d.close })));
      volume.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.volume, color: d.close >= d.open ? "rgba(52,194,142,0.35)" : "rgba(240,100,106,0.35)" })));
      last.current = data[data.length - 1] ?? null;
      chart.current?.timeScale().fitContent();
    });
    return () => { cancelled = true; };
  }, [symbol, timeframe, precision]);

  // Fold live prices into the forming candle.
  useEffect(() => {
    const prev = last.current;
    if (mid === null || !prev || !candles.current || !volume.current) return;
    const sec = TIMEFRAME_SECONDS[timeframe];
    const bucket = Math.floor(Date.now() / 1000 / sec) * sec;
    const next: Candle = bucket > prev.time
      ? { time: bucket, open: prev.close, high: Math.max(prev.close, mid), low: Math.min(prev.close, mid), close: mid, volume: 0 }
      : { ...prev, high: Math.max(prev.high, mid), low: Math.min(prev.low, mid), close: mid };
    last.current = next;
    candles.current.update({ time: next.time as UTCTimestamp, open: next.open, high: next.high, low: next.low, close: next.close });
    volume.current.update({ time: next.time as UTCTimestamp, value: next.volume, color: next.close >= next.open ? "rgba(52,194,142,0.35)" : "rgba(240,100,106,0.35)" });
  }, [mid, timeframe]);

  // Entry / SL / TP / pending-order lines.
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = levels.map((l) => s.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title,
    }));
  }, [levels]);

  return <div ref={box} className="chart-box" role="img" aria-label={`${symbol} candlestick chart`} />;
}

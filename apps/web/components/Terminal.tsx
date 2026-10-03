"use client";

import { useMemo, useRef, useState } from "react";
import { D, effectiveQuote, positionPnl, requiredMargin, type Instrument, type Position, type Quote } from "@tlp/trading-core";
import { TIMEFRAMES, type Timeframe } from "@tlp/market-data";
import Chart, { type ChartLevel } from "./Chart";
import { INSTRUMENTS, useSession, type ActionResult } from "../lib/session";
import { fmtMoney, fmtPrice, fmtSigned, fmtTime, tone } from "../lib/format";

const LIST = Object.values(INSTRUMENTS);
type Tab = "positions" | "orders" | "history";

export default function Terminal() {
  const s = useSession();
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [tab, setTab] = useState<Tab>("positions");
  const firstMid = useRef<Record<string, number>>({});

  const inst = INSTRUMENTS[symbol]!;
  const px = (q: Quote | undefined) => (q ? effectiveQuote(q, s.ctx.config.spreadMarkup) : null);
  const current = px(s.quotes[symbol]);
  const mid = current ? current.bid.plus(current.ask).div(2).toNumber() : null;

  const pendingOrders = s.state.orders.filter((o) => o.status === "PENDING");
  const trades = [...s.state.trades].reverse();

  const levels = useMemo<ChartLevel[]>(() => {
    const out: ChartLevel[] = [];
    for (const p of s.state.positions.filter((x) => x.symbol === symbol)) {
      out.push({ price: Number(p.entryPrice), color: "#d4a84b", title: `${p.side} ${p.quantity}` });
      if (p.stopLoss) out.push({ price: Number(p.stopLoss), color: "#f0646a", title: "SL", dashed: true });
      if (p.takeProfit) out.push({ price: Number(p.takeProfit), color: "#34c28e", title: "TP", dashed: true });
    }
    for (const o of pendingOrders.filter((x) => x.symbol === symbol)) {
      out.push({ price: Number(o.requestedPrice), color: "#8493a6", title: `${o.type} ${o.side}`, dashed: true });
    }
    return out;
  }, [s.state.positions, pendingOrders, symbol]);

  const sum = s.summary;
  const strip: { label: string; value: string; t?: "up" | "down" | "flat" }[] = [
    { label: "Balance", value: fmtMoney(sum.balance) },
    { label: "Equity", value: fmtMoney(sum.equity) },
    { label: "Used margin", value: fmtMoney(sum.usedMargin) },
    { label: "Free margin", value: fmtMoney(sum.freeMargin) },
    { label: "Margin level", value: sum.marginLevel ? `${Number(sum.marginLevel).toFixed(0)}%` : "–" },
    { label: "Unrealized P&L", value: fmtSigned(sum.unrealizedPnl), t: tone(sum.unrealizedPnl) },
    { label: "Realized P&L", value: fmtSigned(sum.realizedPnl), t: tone(sum.realizedPnl) },
  ];

  const doReset = () => {
    if (window.confirm("Reset the demo account? All open positions and pending orders are closed and the balance returns to $10,000.00. Trade history is kept.")) s.reset();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="3" y="9" width="4" height="11" rx="1" fill="#f0646a" /><rect x="4.6" y="5" width="0.8" height="19" fill="#f0646a" />
            <rect x="11" y="5" width="4" height="12" rx="1" fill="#34c28e" /><rect x="12.6" y="2" width="0.8" height="19" fill="#34c28e" />
            <rect x="19" y="8" width="4" height="9" rx="1" fill="#d4a84b" /><rect x="20.6" y="4" width="0.8" height="17" fill="#d4a84b" />
          </svg>
          <span className="wordmark">TradeLab</span>
        </div>
        <span className="demo-badge" title="All funds are virtual. Nothing here is real money.">DEMO · paper trading · virtual funds</span>
        <button className="btn ghost" onClick={doReset}>Reset demo account</button>
      </header>

      <section className="strip" aria-label="Account summary">
        {strip.map((i) => (
          <div key={i.label} className="stat">
            <span className="stat-label">{i.label}</span>
            <span className={`stat-value num ${i.t ?? ""}`}>{i.value}</span>
          </div>
        ))}
      </section>

      <main className="grid">
        <section className="panel watch" aria-label="Market watch">
          <h2>Market watch</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>Symbol</th><th className="r">Bid</th><th className="r">Ask</th><th className="r">Spr</th><th className="r" title="Change since this page was opened">Chg %</th></tr></thead>
              <tbody>
                {LIST.map((i) => {
                  const q = px(s.quotes[i.symbol]);
                  const m = q ? q.bid.plus(q.ask).div(2).toNumber() : null;
                  if (m !== null) firstMid.current[i.symbol] ??= m;
                  const base = firstMid.current[i.symbol];
                  const chg = m !== null && base ? ((m - base) / base) * 100 : 0;
                  return (
                    <tr key={i.symbol} className={i.symbol === symbol ? "sel" : ""} onClick={() => setSymbol(i.symbol)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter") setSymbol(i.symbol); }}>
                      <td><strong>{i.symbol}</strong></td>
                      <td className="r num">{q ? fmtPrice(q.bid.toString(), i) : "–"}</td>
                      <td className="r num">{q ? fmtPrice(q.ask.toString(), i) : "–"}</td>
                      <td className="r num muted">{q ? fmtPrice(q.ask.minus(q.bid).toString(), i) : "–"}</td>
                      <td className={`r num ${tone(chg)}`}>{chg.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel chart-panel" aria-label="Chart">
          <div className="chart-head">
            <div>
              <h2>{inst.symbol} <span className="muted sub">{inst.displayName}</span></h2>
              <div className="big num">{current ? `${fmtPrice(current.bid.toString(), inst)} / ${fmtPrice(current.ask.toString(), inst)}` : "…"}</div>
            </div>
            <div className="tf" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button key={t} className={t === timeframe ? "on" : ""} onClick={() => setTimeframe(t)}>{t}</button>
              ))}
            </div>
          </div>
          <Chart symbol={symbol} timeframe={timeframe} precision={inst.pricePrecision} mid={mid} levels={levels} />
          <p className="note">Simulated prices for learning. Not real market data.</p>
        </section>

        <OrderTicket inst={inst} bid={current?.bid.toNumber() ?? null} ask={current?.ask.toNumber() ?? null} s={s} />
      </main>

      <section className="panel lower" aria-label="Positions and history">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "positions"} className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>Positions ({s.state.positions.length})</button>
          <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "on" : ""} onClick={() => setTab("orders")}>Pending orders ({pendingOrders.length})</button>
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History ({trades.length})</button>
        </div>
        <div className="scroll">
          {tab === "positions" && <PositionsTable s={s} />}
          {tab === "orders" && (
            <table>
              <thead><tr><th>Symbol</th><th>Type</th><th>Side</th><th className="r">Qty</th><th className="r">Price</th><th className="r">SL</th><th className="r">TP</th><th /></tr></thead>
              <tbody>
                {pendingOrders.length === 0 && <tr><td colSpan={8} className="empty">No pending orders.</td></tr>}
                {pendingOrders.map((o) => {
                  const i = INSTRUMENTS[o.symbol]!;
                  return (
                    <tr key={o.id}>
                      <td><strong>{o.symbol}</strong></td><td>{o.type}</td><td className={o.side === "BUY" ? "up" : "down"}>{o.side}</td>
                      <td className="r num">{o.quantity}</td><td className="r num">{fmtPrice(o.requestedPrice, i)}</td>
                      <td className="r num">{fmtPrice(o.stopLoss, i)}</td><td className="r num">{fmtPrice(o.takeProfit, i)}</td>
                      <td className="r"><button className="btn small" onClick={() => { const r = s.cancel(o.id); if (!r.ok) s.notice("bad", r.error); }}>Cancel</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {tab === "history" && (
            <table>
              <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th className="r">Qty</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Gross</th><th className="r">Fees</th><th className="r">Net</th><th>Reason</th></tr></thead>
              <tbody>
                {trades.length === 0 && <tr><td colSpan={10} className="empty">No closed trades yet. Open a position and close it to see it here.</td></tr>}
                {trades.map((t) => {
                  const i = INSTRUMENTS[t.symbol]!;
                  return (
                    <tr key={t.id}>
                      <td className="muted">{fmtTime(t.closedAt)}</td><td><strong>{t.symbol}</strong></td>
                      <td className={t.side === "BUY" ? "up" : "down"}>{t.side}</td><td className="r num">{t.quantity}</td>
                      <td className="r num">{fmtPrice(t.entryPrice, i)}</td><td className="r num">{fmtPrice(t.exitPrice, i)}</td>
                      <td className={`r num ${tone(t.grossPnl)}`}>{fmtSigned(t.grossPnl)}</td>
                      <td className="r num muted">{fmtMoney(t.commission)}</td>
                      <td className={`r num ${tone(t.netPnl)}`}>{fmtSigned(t.netPnl)}</td>
                      <td className="muted">{t.closeReason.replace("_", " ").toLowerCase()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <footer className="foot">
        <p>
          TradeLab is an educational paper-trading simulator. All money is virtual and nothing here is financial advice.
          Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>.
        </p>
      </footer>

      <div className="toasts" aria-live="polite">
        {s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

type Session = ReturnType<typeof useSession>;

function OrderTicket({ inst, bid, ask, s }: { inst: Instrument; bid: number | null; ask: number | null; s: Session }) {
  const [type, setType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [qty, setQty] = useState("0.10");
  const [price, setPrice] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [err, setErr] = useState<string | null>(null);

  let margin = "–";
  try {
    if (ask !== null) margin = fmtMoney(requiredMargin(inst, D(qty), D(ask), s.ctx).toString());
  } catch { /* incomplete input */ }

  const send = (side: "BUY" | "SELL") => {
    const r: ActionResult = s.submit({
      symbol: inst.symbol, side, type, quantity: qty,
      price: type === "MARKET" ? undefined : price, stopLoss: sl || undefined, takeProfit: tp || undefined,
    });
    if (r.ok) { setErr(null); if (type !== "MARKET") setPrice(""); } else setErr(r.error);
  };

  return (
    <section className="panel ticket" aria-label="Order ticket">
      <h2>Order ticket <span className="muted sub">{inst.symbol}</span></h2>
      <div className="seg" role="group" aria-label="Order type">
        {(["MARKET", "LIMIT", "STOP"] as const).map((t) => (
          <button key={t} className={t === type ? "on" : ""} onClick={() => setType(t)}>{t[0] + t.slice(1).toLowerCase()}</button>
        ))}
      </div>
      <label>Volume (lots)
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      {type !== "MARKET" && (
        <label>{type === "LIMIT" ? "Limit price" : "Stop price"}
          <input inputMode="decimal" value={price} placeholder={ask !== null ? fmtPrice(ask, inst) : ""} onChange={(e) => setPrice(e.target.value)} />
        </label>
      )}
      <div className="two">
        <label>Stop-loss<input inputMode="decimal" value={sl} placeholder="optional" onChange={(e) => setSl(e.target.value)} /></label>
        <label>Take-profit<input inputMode="decimal" value={tp} placeholder="optional" onChange={(e) => setTp(e.target.value)} /></label>
      </div>
      <p className="hint">Estimated margin: <span className="num">{margin}</span> at 1:{s.ctx.config.leverage} leverage</p>
      <div className="two">
        <button className="btn sell" onClick={() => send("SELL")}><span>Sell{type !== "MARKET" ? ` ${type.toLowerCase()}` : ""}</span><b className="num">{fmtPrice(bid, inst)}</b></button>
        <button className="btn buy" onClick={() => send("BUY")}><span>Buy{type !== "MARKET" ? ` ${type.toLowerCase()}` : ""}</span><b className="num">{fmtPrice(ask, inst)}</b></button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <p className="hint">Stop-loss and take-profit close the position automatically when the price reaches them.</p>
    </section>
  );
}

function LevelInput({ value, inst, onCommit }: { value: string | null; inst: Instrument; onCommit: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : value ?? "";
  const commit = () => {
    setEditing(false);
    const next = text.trim() === "" ? null : text.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <input className="lvl num" inputMode="decimal" value={shown} placeholder="–" aria-label="level"
      onFocus={() => { setText(value ?? ""); setEditing(true); }} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(value ?? ""); setEditing(false); (e.target as HTMLInputElement).blur(); } }}
      title={`Up to ${inst.pricePrecision} decimals`} />
  );
}

function halfOf(p: Position, inst: Instrument): string | null {
  const step = D(inst.qtyStep);
  const half = D(p.quantity).div(2).div(step).floor().times(step);
  return half.gte(inst.minQty) && half.lt(p.quantity) ? half.toString() : null;
}

function PositionsTable({ s }: { s: Session }) {
  const rows = s.state.positions;
  const act = (r: ActionResult) => { if (!r.ok) s.notice("bad", r.error); };
  return (
    <table>
      <thead><tr><th>Symbol</th><th>Side</th><th className="r">Qty</th><th className="r">Entry</th><th className="r">Price</th><th className="r">SL</th><th className="r">TP</th><th className="r">P&amp;L</th><th /></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="empty">No open positions. Use the order ticket to place a demo trade.</td></tr>}
        {rows.map((p) => {
          const i = INSTRUMENTS[p.symbol]!;
          const q = s.quotes[p.symbol];
          const e = q ? effectiveQuote(q, s.ctx.config.spreadMarkup) : null;
          const now = e ? (p.side === "BUY" ? e.bid : e.ask).toString() : null;
          const pnl = positionPnl(p, s.ctx);
          const half = halfOf(p, i);
          return (
            <tr key={p.id}>
              <td><strong>{p.symbol}</strong></td><td className={p.side === "BUY" ? "up" : "down"}>{p.side}</td>
              <td className="r num">{p.quantity}</td><td className="r num">{fmtPrice(p.entryPrice, i)}</td><td className="r num">{fmtPrice(now, i)}</td>
              <td className="r"><LevelInput key={`sl-${p.stopLoss}`} value={p.stopLoss} inst={i} onCommit={(v) => act(s.setLevels(p.id, { stopLoss: v }))} /></td>
              <td className="r"><LevelInput key={`tp-${p.takeProfit}`} value={p.takeProfit} inst={i} onCommit={(v) => act(s.setLevels(p.id, { takeProfit: v }))} /></td>
              <td className={`r num ${tone(pnl)}`}><strong>{fmtSigned(pnl)}</strong></td>
              <td className="r actions">
                {half && <button className="btn small" onClick={() => act(s.close(p.id, half))} title={`Close ${half} lots`}>Close ½</button>}
                <button className="btn small" onClick={() => act(s.close(p.id))}>Close</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

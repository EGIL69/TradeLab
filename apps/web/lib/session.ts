"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONFIG, DEFAULT_INSTRUMENTS, TradingError, cancelOrder, closePosition, createAccount, modifyPosition,
  placeOrder, processQuote, resetAccount, summarize,
  type AccountSummary, type EngineContext, type EngineEvent, type EngineResult, type EngineState, type Instrument,
  type OrderRequest, type Quote,
} from "@tlp/trading-core";
import { provider } from "./provider";

const STORAGE_KEY = "tradelab.account.v1";
export const INSTRUMENTS: Record<string, Instrument> = Object.fromEntries(DEFAULT_INSTRUMENTS.map((i) => [i.symbol, i]));

export interface Toast { id: number; kind: "good" | "bad" | "info"; text: string }
export type ActionResult = { ok: true } | { ok: false; error: string };

function load(): EngineState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as EngineState;
      if (p && Array.isArray(p.positions) && Array.isArray(p.orders) && Array.isArray(p.trades) && typeof p.balance === "string") return p;
    }
  } catch { /* ignore corrupt storage */ }
  return createAccount("10000");
}

/**
 * Browser-side session for Phase 1b: the engine runs in the page and the account is kept in localStorage.
 * Phase 4 moves execution to the server, so the browser can no longer edit balances.
 */
export function useSession() {
  const [state, setState] = useState<EngineState>(load);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef(state);
  const quotesRef = useRef<Record<string, Quote>>({});
  const toastId = useRef(1);

  const notice = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const notify = useCallback((events: EngineEvent[]) => {
    for (const e of events) {
      const kind = e.type === "TAKE_PROFIT_TRIGGERED" || e.type === "ORDER_FILLED" ? "good" : e.type === "STOP_LOSS_TRIGGERED" ? "bad" : "info";
      const label = e.type.replace(/_/g, " ").toLowerCase();
      notice(kind, `${label}: ${e.message}`);
    }
  }, [notice]);

  const commit = useCallback((s: EngineState) => { stateRef.current = s; setState(s); }, []);

  const makeCtx = useCallback((q: Record<string, Quote>): EngineContext => ({
    instruments: INSTRUMENTS, quotes: q, config: DEFAULT_CONFIG, now: Date.now(), newId: () => crypto.randomUUID(),
  }), []);

  useEffect(() => {
    const id = provider.subscribeQuotes(DEFAULT_INSTRUMENTS.map((i) => i.symbol), (q) => {
      quotesRef.current = { ...quotesRef.current, [q.symbol]: q };
      setQuotes(quotesRef.current);
      try {
        const r = processQuote(stateRef.current, q.symbol, makeCtx(quotesRef.current));
        if (r.state !== stateRef.current) { commit(r.state); notify(r.events); }
      } catch (e) { console.error("processQuote failed", e); }
    });
    return () => provider.unsubscribeQuotes(id);
  }, [commit, makeCtx, notify]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }, [state]);

  const run = useCallback((fn: (s: EngineState, ctx: EngineContext) => EngineResult): ActionResult => {
    try {
      const r = fn(stateRef.current, makeCtx(quotesRef.current));
      commit(r.state); notify(r.events);
      return { ok: true };
    } catch (e) {
      const error = e instanceof TradingError ? e.message : "Unexpected error";
      if (!(e instanceof TradingError)) console.error(e);
      return { ok: false, error };
    }
  }, [commit, makeCtx, notify]);

  const ctx = useMemo(() => makeCtx(quotes), [makeCtx, quotes]);
  const summary: AccountSummary = useMemo(() => summarize(state, ctx), [state, ctx]);

  return {
    state, quotes, ctx, summary, toasts, notice,
    submit: (req: Omit<OrderRequest, "clientRequestId">) => run((s, c) => placeOrder(s, { ...req, clientRequestId: crypto.randomUUID() }, c)),
    close: (id: string, qty?: string) => run((s, c) => closePosition(s, id, qty, c)),
    cancel: (id: string) => run((s, c) => cancelOrder(s, id, c)),
    setLevels: (id: string, levels: { stopLoss?: string | null; takeProfit?: string | null }) => run((s, c) => modifyPosition(s, id, levels, c)),
    reset: () => run((s, c) => resetAccount(s, c)),
  };
}

# TradeLab

An educational paper-trading simulator. All funds are virtual. No deposits, withdrawals or real trading.

## Run it (GitHub Codespaces or any machine with Node 20+)

    npm install
    npm test                 # trading engine tests
    npm run dev -w @tlp/web  # web terminal on http://localhost:3000

In Codespaces, click "Open in Browser" when the port 3000 popup appears.

## Commands

| What | Command |
|---|---|
| Install | `npm install` |
| Web dev server | `npm run dev -w @tlp/web` |
| Tests | `npm test` |
| TypeScript check | `npm run typecheck --workspaces --if-present` |
| Production build | `npm run build -w @tlp/web` |

## Simulator rules

- Buys fill at the ask, sells at the bid. A long's P&L is measured at the bid, a short's at the ask.
- Each market order opens its own position (hedging style).
- Margin = notional / leverage (1:100). Orders are rejected if they exceed free margin.
- Stop-loss and take-profit close at the current quote when touched, so gaps can fill worse than the level.
- Limit orders never fill worse than their price. Stop orders fill at the market once triggered.
- Account reset closes everything and restores $10,000. History is kept.

## Current limits (Phase 1b)

Prices are simulated. The account lives in your browser's localStorage, so it can be edited by the user.
Phase 2 and 4 move accounts and order execution to Supabase and the server.

Charts: TradingView Lightweight Charts(TM).

# pump.fun Monitor (Node.js) — Read-only + Web Dashboard

**What it does**
- Polls new token listings (e.g., pump.fun or any endpoint you configure)
- Computes a simple risk score
- Sends alerts to Telegram/Discord/Webhook (optional)
- Serves a **web UI** to view listings, risk flags, and create **unsigned** swap payloads

**What it does *not* do**
- It **does not** sign or send transactions
- No automated buying/sniping

## Quick start
```bash
cp .env.example .env
npm install
npm start
```
Open http://localhost:8080/

## Prepare actions
- **EVM (Uniswap v2 Router):** creates an **unsigned** call to `swapExactETHForTokens` using Router02 at `ROUTER_ADDRESS`.
- **Solana:** creates a **Jupiter Terminal** swap URL and a **Phantom browse deeplink** to open that URL inside Phantom.

> References: Uniswap v2 Router02 address on Ethereum mainnet, Jupiter Docs (Swap API & Terminal), Phantom Deeplinks.

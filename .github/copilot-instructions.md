## pump.fun Monitor — quick context for AI agents

This repository is a small Node.js read-only monitor and web dashboard that polls a "new listings" API, enriches results, scores risk, and exposes a web UI and an endpoint to build unsigned swap payloads.

Keep guidance short, concrete, and file-focused. Prefer changes to one file at a time and run the app locally to validate behavior (see "Run / debug").

### Big picture / architecture
- index.js: main process. Polls the external API (PUMPFUN_API_URL), enriches items via `onchain.enrichOnChain`, scores via `scoring.scoreToken`, stores in-memory (`STORE`), and notifies via `notifier` classes. Also starts the Express web server which serves `public` and exposes two APIs: `/api/listings` and `/api/prepare`.
- onchain.js: chain helpers. For EVM it can build an unsigned Uniswap v2 `swapExactETHForTokens` transaction (requires RPC). For Solana it builds Jupiter swap URLs and Phantom deeplinks.
- scoring.js: simple deterministic scoring logic. Look here to understand how flags (e.g. `Low LP`, `Top-10 concentrated`) and the numeric score are produced.
- notifier.js: Telegram/Discord/Webhook notifier wrappers that read environment variables and POST messages.
- public/index.html: minimal web UI (polls `/api/listings` and calls `/api/prepare` on user action).
- sample_api_response.json: example API payload shape used by the app. Useful for local testing or mocked responses.

### Key runtime contracts and data shapes
- Listings: objects typically contain { name, symbol, contract, lp_usd, chain, timestamp, top10_percent, verified, owner_privileged } — see `sample_api_response.json`.
- Scoring output: `scoreToken` returns `{ score, flags }` where `score` is 0–100 and `flags` is an array of strings. Use this when presenting or filtering listings.
- Prepare endpoint: POST `/api/prepare` accepts JSON; for EVM returns `{ chain:'evm', to, data, value, note }`, for Solana returns `{ chain:'solana', jupiterUrl, phantomDeeplink, note }`.

### Environment variables (discoverable from code)
- PUMPFUN_API_URL — endpoint polled for new listings (default set in `index.js`).
- POLL_INTERVAL_SECONDS — poll frequency.
- PORT — web server port (default 8080).
- CHAIN — default chain mode (`solana` or `ethereum`).
- TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — for TelegramNotifier.
- DISCORD_WEBHOOK_URL — for DiscordNotifier.
- WEBHOOK_URL — generic webhook notifier.
- RPC_PROVIDER — JSON-RPC URL required by `prepareUnsignedTxEvm` and `enrichOnChain`.
- ROUTER_ADDRESS, WETH_ADDRESS — EVM router and WETH addresses (defaults present).

Security note: the repository contains a long URL string in `index.js` (looks like an API key). Treat any embedded tokens as secrets — prefer using `.env` and never commit real secrets.

### Developer workflows / commands
- Install and run:
  - cp .env.example .env
  - npm install
  - npm start
  - For auto-reload: npm run dev (uses nodemon)
- Web UI: open http://localhost:8080/ after starting.
- Local testing with `sample_api_response.json`: run a small static server (e.g. `npx http-server -p 9000 .`) and set `PUMPFUN_API_URL=http://localhost:9000/sample_api_response.json` to simulate listings.

### Common patterns & caveats for contributors / agents
- In-memory store: `STORE` in `index.js` is ephemeral. There is no DB or persistence. Tests or changes that expect persistence must add one.
- Poll loop: `pollLoop()` is infinite and blocking; edit or run with care during debugging. Use `POLL_INTERVAL_SECONDS` to slow it down.
- EVM unsigned txs require `RPC_PROVIDER`; if missing, `prepareUnsignedTxEvm` returns null. Don't assume the EVM flow works without an RPC provider.
- Solana flow returns deeplinks/URLs only — no signing or transaction encoding is attempted here.
- Notifications are best-effort: `notifier` methods catch and log errors and return false on failure.

### Useful examples (from this repo)
- Example: `scoring.scoreToken({ lp_usd: 50, top10_percent: 82, verified: false })` will produce flags like `Low LP`, `Top-10 concentrated`, and `Unverified contract` and push the score up accordingly — see `scoring.js` for the exact thresholds.
- Example: to build a Solana deeplink, call `prepareUnsignedTxSolana({ outputMint: '<mint>', amount: 10000000 })` — returns `{ jupiterUrl, phantomDeeplink }` (see `onchain.js`).
- Example: curl the prepare endpoint (EVM):
  - POST to `http://localhost:8080/api/prepare` with body: `{ "chain": "ethereum", "contract":"0x...", "toAddress":"0xYourWallet","ethValue":"0.01" }`

### When editing, prefer these small validation steps
1. Run `npm start` and confirm server boots and the web UI loads at `/`.
2. Use `sample_api_response.json` (via a static server) or point `PUMPFUN_API_URL` at a known test JSON to confirm listing ingestion.
3. Check console logs for `New listing:` lines and notification attempts.

If anything above is unclear or you'd like more examples (e.g., unit-test harness, a small mock server, or a CI step), tell me which section to expand and I'll update this file.

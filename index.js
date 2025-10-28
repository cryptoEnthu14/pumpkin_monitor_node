require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const { scoreToken } = require('./scoring');
const { TelegramNotifier, DiscordNotifier, WebhookNotifier } = require('./notifier');
const { enrichOnChain, prepareUnsignedTxEvm, prepareUnsignedTxSolana } = require('./onchain');

// const PUMPFUN_API_URL = process.env.PUMPFUN_API_URL || 'https://api.pump.fun/new_listings';
const PUMPFUN_API_URL = process.env.PUMPFUN_API_URL || 'https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/new?limit=10?X-API-Key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ijc0NzNkY2IzLWVmN2UtNGEwYy04ZWYzLThiMDBlOWZhZDZjZiIsIm9yZ0lkIjoiNDc4MjQxIiwidXNlcklkIjoiNDkyMDEwIiwidHlwZUlkIjoiYzdhZDcxMmYtNTIwMS00MDM1LTg2ZjctYzYzNGE1NzE2Yjc1IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjE2MTI4MTgsImV4cCI6NDkxNzM3MjgxOH0.rR3nHSANmyKgT3FJz3kaBowjsBRUvFr9jFDt26eJbHY';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_SECONDS || 10) * 1000;
const PORT = Number(process.env.PORT || 8080);
//const CHAIN = (process.env.CHAIN || 'ethereum').toLowerCase();
const CHAIN = (process.env.CHAIN || 'solana').toLowerCase();

const tg = new TelegramNotifier();
const dc = new DiscordNotifier();
const wh = new WebhookNotifier();
const seen = new Set();
const STORE = []; // simple in-memory store

async function fetchNewListings() {
  try {
    const r = await axios.get(PUMPFUN_API_URL, { timeout: 8000 });
    return Array.isArray(r.data) ? r.data : [];
  } catch (e) {
    console.error('Error fetching listings:', e.message || e);
    return [];
  }
}

async function handleListing(item) {
  const contract = item.contract || item.address;
  if (!contract || seen.has(contract)) return;
  seen.add(contract);

  const enriched = await enrichOnChain(contract, item);
  const { score, flags } = scoreToken(enriched);

  const summary = {
    timestamp: Date.now(),
    name: enriched.name || item.name,
    symbol: enriched.symbol || item.symbol,
    contract,
    lp_usd: enriched.lp_usd,
    chain: enriched.chain || CHAIN,
    score,
    flags,
  };

  console.info(`New listing: ${summary.symbol} (${summary.contract}) - Score ${score} Flags: ${flags.join(', ')}`);
  STORE.unshift(summary);
  if (STORE.length > 500) STORE.pop();

  await tg.send(`New listing: ${summary.symbol} (${summary.contract}) - Score ${score} Flags: ${flags.join(', ')}`);
  await dc.send(`New listing: ${summary.symbol} (${summary.contract}) - Score ${score} Flags: ${flags.join(', ')}`);
  await wh.send({ type: 'new_listing', payload: summary });
}

async function pollLoop() {
  console.log('Polling:', PUMPFUN_API_URL, 'chain:', CHAIN);
  while (true) {
    try {
      const listings = await fetchNewListings();
      for (const it of listings) {
        try { await handleListing(it); } catch (e) { console.error('handleListing error', e); }
      }
    } catch (e) {
      console.error('Poll loop error', e);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// --- Web server ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/listings', (_, res) => res.json(STORE));

app.post('/api/prepare', async (req, res) => {
  const { chain, contract, toAddress, amountOutMin, ethValue, deadlineSeconds, inputMint, outputMint, amount } = req.body || {};
  try {
    if ((chain || CHAIN) === 'solana') {
      const out = prepareUnsignedTxSolana({
        inputMint: inputMint || 'So11111111111111111111111111111111111111112',
        outputMint: outputMint || contract,
        amount: amount || 10000000 // 0.01 SOL in lamports as example
      });
      return res.json(out);
    } else {
      const out = await prepareUnsignedTxEvm(contract, { toAddress, amountOutMin, ethValue, deadlineSeconds });
      return res.json(out || { error: 'Failed to build EVM tx' });
    }
  } catch (e) {
    console.error('prepare error', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, () => console.log('Web UI at http://localhost:' + PORT));

pollLoop().catch(e => { console.error('Fatal', e); process.exit(1); });

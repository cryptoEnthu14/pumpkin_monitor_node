require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const { scoreToken } = require('./scoring');
const { TelegramNotifier, DiscordNotifier, WebhookNotifier } = require('./notifier');
const { enrichOnChain, prepareUnsignedTxEvm, prepareUnsignedTxSolana } = require('./onchain');

const DEFAULT_LIMIT = Number(process.env.PUMPFUN_LIMIT || 20);
const DEFAULT_API_URL = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/new?limit=${DEFAULT_LIMIT}`;
const PUMPFUN_API_URL = process.env.PUMPFUN_API_URL || DEFAULT_API_URL;
const MORALIS_API_KEY = process.env.PUMPFUN_API_KEY || process.env.MORALIS_API_KEY || '';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_SECONDS || 10) * 1000;
const ONESHOT = String(process.env.PUMPFUN_ONESHOT || '').toLowerCase() === 'true';
const PORT = Number(process.env.PORT || 8080);
//const CHAIN = (process.env.CHAIN || 'ethereum').toLowerCase();
const CHAIN = (process.env.CHAIN || 'solana').toLowerCase();

if (PUMPFUN_API_URL.includes('moralis.io') && !MORALIS_API_KEY) {
  console.warn('Moralis API key missing: set MORALIS_API_KEY or PUMPFUN_API_KEY in your .env file.');
}

const tg = new TelegramNotifier();
const dc = new DiscordNotifier();
const wh = new WebhookNotifier();
const seen = new Set();
const STORE = []; // simple in-memory store

async function fetchNewListings() {
  try {
    const headers = { Accept: 'application/json' };
    if (MORALIS_API_KEY) headers['X-API-Key'] = MORALIS_API_KEY;
    const r = await axios.get(PUMPFUN_API_URL, { timeout: 8000, headers });
    const payload = r.data;
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
      const keys = ['result', 'results', 'data', 'items', 'tokens'];
      for (const key of keys) {
        if (Array.isArray(payload[key])) {
          return payload[key];
        }
      }
    }
    return [];
  } catch (e) {
    console.error('Error fetching listings:', e.message || e);
    return [];
  }
}

async function handleListing(item) {
  const normalized = normalizeListing(item);
  const contract = normalized.contract;
  if (!contract || seen.has(contract)) return;
  seen.add(contract);

  const enriched = await enrichOnChain(contract, normalized);
  const { score, flags } = scoreToken(enriched);

  const summary = {
    timestamp: Date.now(),
    name: enriched.name || normalized.name,
    symbol: enriched.symbol || normalized.symbol,
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

function normalizeListing(item = {}) {
  const contract = item.contract
    || item.address
    || item.mint
    || item.mintAddress
    || item.tokenAddress
    || item.publicKey;

  const chain = (item.chain || item.network || item.chainId || CHAIN || '').toString().toLowerCase() || CHAIN;
  const lpUsdRaw = item.lp_usd ?? item.liquidityUsd ?? item.liquidity ?? item.usdLiquidity ?? item.usd_liquidity;
  const top10Raw = item.top10_percent ?? item.top10Percent ?? item.top10Score ?? item.top10Share;

  return {
    ...item,
    contract,
    address: contract,
    name: item.name || item.tokenName || item.project_name,
    symbol: item.symbol || item.ticker || item.tokenSymbol,
    lp_usd: typeof lpUsdRaw === 'string' ? Number(lpUsdRaw) : lpUsdRaw,
    top10_percent: typeof top10Raw === 'string' ? Number(top10Raw) : top10Raw,
    owner_privileged: item.owner_privileged ?? item.ownerPrivileged ?? item.creatorPrivileged,
    verified: item.verified ?? item.isVerified ?? item.contractVerified ?? false,
    chain
  };
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
    if (ONESHOT) return;
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// --- Web server ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/listings', (_, res) => res.json(STORE));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

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

const server = app.listen(PORT, () => console.log('Web UI at http://localhost:' + PORT));

pollLoop()
  .then(() => {
    if (ONESHOT) {
      server.close(() => process.exit(0));
    }
  })
  .catch(e => { console.error('Fatal', e); process.exit(1); });

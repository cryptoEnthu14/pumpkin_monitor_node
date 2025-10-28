const { ethers } = require('ethers');

const RPC = process.env.RPC_PROVIDER || '';
const provider = RPC ? new ethers.JsonRpcProvider(RPC) : null;

// EVM config
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Uniswap v2 Router02 (Ethereum mainnet)
const WETH_ADDRESS = process.env.WETH_ADDRESS || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const routerAbi = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)"
];

async function enrichOnChain(contractAddress, item = {}) {
  const out = { ...item };
  try {
    if (provider) {
      const code = await provider.getCode(contractAddress).catch(() => '0x');
      out.verified = code && code !== '0x';
    } else out.verified = false;
  } catch (e) {
    console.warn('enrichOnChain warning:', e.message || e);
  }
  return out;
}

/**
 * EVM unsigned tx template (Uniswap v2 Router02).
 * Note: caller must set 'toAddress' and 'ethValue' sensibly before signing in wallet.
 */
async function prepareUnsignedTxEvm(tokenAddress, { toAddress, amountOutMin = 0, ethValue = "0.01", deadlineSeconds = 600 } = {}) {
  if (!provider) return null;
  try {
    const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, provider);
    const path = [WETH_ADDRESS, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + Number(deadlineSeconds);
    const tx = await router.populateTransaction.swapExactETHForTokens(
      amountOutMin,
      path,
      toAddress || ethers.ZeroAddress,
      deadline,
      { value: ethers.parseEther(String(ethValue)) }
    );
    return {
      chain: 'evm',
      router: ROUTER_ADDRESS,
      to: tx.to,
      data: tx.data,
      value: tx.value?.toString(),
      gasLimit: tx.gasLimit?.toString(),
      note: 'Unsigned EVM tx for Uniswap v2. Set "toAddress" to your wallet before signing.'
    };
  } catch (e) {
    console.warn('prepareUnsignedTxEvm failed:', e.message || e);
    return null;
  }
}

/**
 * Solana (read-only) helpers:
 * - Jupiter Terminal URL (opens a prefilled swap in web)
 * - Phantom "browse" deeplink to open the above URL inside Phantom's in-app browser
 *
 * References:
 *  - Jupiter Terminal docs/guides
 *  - Phantom Deeplinks: https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 */
function buildJupiterSwapUrl({ inputMint = 'So11111111111111111111111111111111111111112', outputMint, amount }) {
  // amount in natural units of input token (e.g., lamports for SOL)
  const base = 'https://jup.ag/swap';
  const params = new URLSearchParams();
  if (inputMint) params.set('inputMint', inputMint);
  if (outputMint) params.set('outputMint', outputMint);
  if (amount) params.set('amount', String(amount));
  return `${base}?${params.toString()}`;
}

function buildPhantomBrowseDeeplink(targetUrl) {
  // Opens targetUrl inside Phantom mobile in-app browser
  const encoded = encodeURIComponent(targetUrl);
  return `https://phantom.app/ul/browse/${encoded}`;
}

function prepareUnsignedTxSolana({ inputMint, outputMint, amount }) {
  const url = buildJupiterSwapUrl({ inputMint, outputMint, amount });
  return {
    chain: 'solana',
    jupiterUrl: url,
    phantomDeeplink: buildPhantomBrowseDeeplink(url),
    note: 'Opens a prefilled Jupiter swap. User reviews and signs in wallet app. No automation.'
  };
}

module.exports = {
  enrichOnChain,
  prepareUnsignedTxEvm,
  prepareUnsignedTxSolana,
  buildJupiterSwapUrl,
  buildPhantomBrowseDeeplink
};

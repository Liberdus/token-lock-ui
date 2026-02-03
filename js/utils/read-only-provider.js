import { CONFIG } from '../config.js';

let providerInstance = null;
let providerPromise = null;

function hashString(str) {
  // Fast non-crypto hash (good enough for cache keys)
  const s = String(str || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  // Convert to unsigned 32-bit
  return (h >>> 0).toString(16);
}

function makeRpcKey(method, params) {
  // Keep keys small (avoid storing huge calldata/log filters as full strings).
  try {
    if (method === 'eth_chainId' || method === 'eth_blockNumber') return method;

    if (method === 'eth_getCode' && Array.isArray(params)) {
      const addr = String(params[0] || '').toLowerCase();
      const blockTag = String(params[1] ?? 'latest');
      return `eth_getCode:${addr}:${blockTag}`;
    }

    if (method === 'eth_call' && Array.isArray(params)) {
      const call = params[0] || {};
      const blockTag = String(params[1] ?? 'latest');
      const to = String(call.to || '').toLowerCase();
      const from = call.from ? String(call.from).toLowerCase() : '';
      const value = call.value ? String(call.value) : '';
      const data = String(call.data || '');
      return `eth_call:${to}:${from}:${value}:${blockTag}:${data.length}:${hashString(data)}`;
    }

    if (method === 'eth_getLogs' && Array.isArray(params)) {
      const filter = params[0] || {};
      const address = String(filter.address || '').toLowerCase();
      const fromBlock = String(filter.fromBlock ?? '');
      const toBlock = String(filter.toBlock ?? '');
      const topics = Array.isArray(filter.topics) ? hashString(JSON.stringify(filter.topics)) : '';
      return `eth_getLogs:${address}:${fromBlock}:${toBlock}:${topics}`;
    }
  } catch {
    // fall through
  }

  // Default: hash the params blob
  try {
    return `${method}:${hashString(JSON.stringify(params || []))}`;
  } catch {
    return `${method}:${String(params)}`;
  }
}

function getRpcCacheTtlMs(method) {
  // Short TTL cache for read-only requests (Phase 9.5)
  if (method === 'eth_chainId') return 24 * 60 * 60 * 1000;
  if (method === 'eth_blockNumber') return 1500;
  if (method === 'eth_getCode') return 60 * 1000;
  if (method === 'eth_call') return 10 * 1000;
  if (method === 'eth_getLogs') return 10 * 1000;
  return 0;
}

function wrapProviderWithRpcCache(provider, { maxEntries = 500 } = {}) {
  if (!provider || typeof provider.send !== 'function') return provider;
  if (provider.__rpcCacheWrapped) return provider;

  const originalSend = provider.send.bind(provider);
  const cache = new Map(); // key -> { expiresAt, value }
  const inflight = new Map(); // key -> Promise

  const prune = () => {
    while (cache.size > maxEntries) {
      const firstKey = cache.keys().next().value;
      if (firstKey == null) break;
      cache.delete(firstKey);
    }
  };

  provider.send = async (method, params) => {
    const key = makeRpcKey(method, params);
    const ttlMs = getRpcCacheTtlMs(method);
    const now = Date.now();

    if (ttlMs > 0) {
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      if (hit && hit.expiresAt <= now) cache.delete(key);
    }

    const inFlight = inflight.get(key);
    if (inFlight) return await inFlight;

    const p = (async () => {
      const value = await originalSend(method, params);
      if (ttlMs > 0) {
        cache.set(key, { expiresAt: now + ttlMs, value });
        prune();
      }
      return value;
    })();

    inflight.set(key, p);
    try {
      return await p;
    } finally {
      inflight.delete(key);
    }
  };

  provider.__rpcCacheWrapped = true;
  return provider;
}

function getEthers() {
  const ethers = window.ethers;
  if (!ethers || !ethers.providers) {
    throw new Error('Ethers.js not loaded');
  }
  return ethers;
}

async function createReadOnlyProvider() {
  const ethers = getEthers();

  const rpcUrl = CONFIG?.NETWORK?.RPC_URL;
  const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID);
  const networkName = CONFIG?.NETWORK?.NAME || 'unknown';

  if (!rpcUrl) throw new Error('Missing CONFIG.NETWORK.RPC_URL');
  if (!Number.isFinite(chainId)) throw new Error('Missing/invalid CONFIG.NETWORK.CHAIN_ID');

  // Best practice:
  // - Prefer a static network provider (prevents repeated network detection / eth_chainId bursts).
  // - Reuse the same provider instance across the whole app.
  const ProviderCtor = ethers.providers.StaticJsonRpcProvider || ethers.providers.JsonRpcProvider;
  const provider = new ProviderCtor(rpcUrl, { chainId, name: networkName });
  wrapProviderWithRpcCache(provider);

  // Validate the RPC is actually on the expected chain (single call).
  // Some providers return a hex string (e.g. "0x89").
  const chainIdHex = await provider.send('eth_chainId', []);
  const actualChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
  if (Number(actualChainId) !== chainId) {
    throw new Error(`Unexpected chainId ${actualChainId} (expected ${chainId})`);
  }

  // Basic health check
  await provider.getBlockNumber();

  providerInstance = provider;
  return provider;
}

export async function getReadOnlyProvider() {
  if (providerInstance) return providerInstance;
  if (!providerPromise) providerPromise = createReadOnlyProvider();
  return await providerPromise;
}

export function peekReadOnlyProvider() {
  return providerInstance;
}

export function resetReadOnlyProvider() {
  providerInstance = null;
  providerPromise = null;
}


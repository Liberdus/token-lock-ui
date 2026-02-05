import { CONFIG } from '../config.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getTokenMetaCacheKey(token) {
  const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
  const addr = String(token || '').toLowerCase();
  if (!chainId || !addr || addr === ZERO_ADDRESS) return null;
  return `liberdus_token_ui:token_meta:v1:${chainId}:${addr}`;
}

export function readTokenMetaCache(token) {
  const key = getTokenMetaCacheKey(token);
  if (!key) return null;
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      window.localStorage?.removeItem(key);
      return null;
    }
    const decimalsValue = Number(parsed.decimals);
    return {
      symbol: typeof parsed.symbol === 'string' ? parsed.symbol : '',
      decimals: Number.isFinite(decimalsValue) ? decimalsValue : 18,
    };
  } catch {
    return null;
  }
}

export function writeTokenMetaCache(token, meta, { ttlMs } = {}) {
  const key = getTokenMetaCacheKey(token);
  if (!key) return;
  try {
    const payload = {
      symbol: typeof meta?.symbol === 'string' ? meta.symbol : '',
      decimals: Number(meta?.decimals ?? 18),
      expiresAt: Date.now() + (Number(ttlMs) || DEFAULT_TTL_MS),
    };
    window.localStorage?.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

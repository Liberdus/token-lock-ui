import { CONFIG } from '../config.js';
import { readTokenMetaCache, writeTokenMetaCache } from '../utils/token-meta-cache.js';
import { extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';
import { setFieldError, clearFieldError, clearFormErrors } from '../utils/form-validation.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const HISTORY_CACHE_REORG_BUFFER = 20;

export class HistoryTab {
  constructor() {
    this.panel = null;
    this._loaded = false;
    this._tokenMeta = new Map();
    this._blockTimeCache = new Map();
    this._historyEvents = [];
    this._lastProvider = null;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="history"]');
    if (!this.panel) return;

    document.addEventListener('tabActivated', (e) => {
      const { tabName, isFirstActivation } = e.detail || {};
      if (tabName === 'history' && isFirstActivation) {
        this._init();
      }
    });
  }

  clearLocalCache() {
    this._tokenMeta.clear();
    this._blockTimeCache.clear();
  }

  _init() {
    if (this._loaded) return;
    this._loaded = true;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Historical Locks</h2>
        <p class="muted">Closed locks (fully withdrawn or retracted). Loaded on demand.</p>
      </div>

      <div class="card">
        <div class="history-controls">
          <label class="history-mine-toggle">
            <input type="checkbox" data-history-mine />
            My completed locks
          </label>
          <details class="history-advanced" data-history-advanced>
            <summary class="history-advanced-summary" title="Toggle advanced filters">Advanced filters</summary>
            <div class="history-advanced-panel">
              <div class="form-grid history-advanced-grid">
              <label class="field">
                <span class="field-label">From block</span>
                <input class="field-input" data-history-from type="number" min="0" step="1" placeholder="0" />
                <span class="field-message"></span>
              </label>
              <label class="field">
                <span class="field-label">To block</span>
                <input class="field-input" data-history-to type="number" min="0" step="1" placeholder="latest" />
                <span class="field-message"></span>
              </label>
              <label class="field">
                <span class="field-label">Creator filter</span>
                <input class="field-input" data-history-creator placeholder="0x..." />
                <span class="field-message"></span>
              </label>
              <label class="field">
                <span class="field-label">Withdraw address filter</span>
                <input class="field-input" data-history-withdraw placeholder="0x..." />
                <span class="field-message"></span>
              </label>
              </div>
            </div>
          </details>
        </div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
          <button type="button" class="btn" data-history-load>Load history</button>
          <div class="muted" data-history-status></div>
        </div>

        <div data-history-list></div>
      </div>
    `;

    this._bind();
  }

  _bind() {
    this.fromInput = this.panel.querySelector('[data-history-from]');
    this.toInput = this.panel.querySelector('[data-history-to]');
    this.creatorInput = this.panel.querySelector('[data-history-creator]');
    this.withdrawInput = this.panel.querySelector('[data-history-withdraw]');
    this.mineInput = this.panel.querySelector('[data-history-mine]');
    this.loadBtn = this.panel.querySelector('[data-history-load]');
    this.statusEl = this.panel.querySelector('[data-history-status]');
    this.listEl = this.panel.querySelector('[data-history-list]');

    this.loadBtn?.addEventListener('click', () => this._loadHistory());
    this.fromInput?.addEventListener('input', () => clearFieldError(this.fromInput));
    this.toInput?.addEventListener('input', () => clearFieldError(this.toInput));
    this.creatorInput?.addEventListener('input', () => clearFieldError(this.creatorInput));
    this.withdrawInput?.addEventListener('input', () => clearFieldError(this.withdrawInput));
    this.panel?.addEventListener('click', (e) => this._handlePanelClick(e));
    this.mineInput?.addEventListener('change', () => {
      this._savePreferences();
      this._applyHistoryFilters();
    });

    document.addEventListener('walletConnected', () => this._syncMineFilterFromWallet());
    document.addEventListener('walletAccountChanged', () => this._syncMineFilterFromWallet());
    document.addEventListener('walletDisconnected', () => this._syncMineFilterFromWallet());

    if (this.fromInput && CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK) {
      this.fromInput.value = String(CONFIG.CONTRACT.DEPLOYMENT_BLOCK);
    }

    this._syncMineFilterFromWallet();
  }

  _setStatus(message) {
    if (this.statusEl) this.statusEl.textContent = message || '';
  }

  async _handlePanelClick(e) {
    const copyBtn = e.target?.closest?.('[data-copy]');
    if (!copyBtn) return;
    const value = copyBtn.dataset.copy || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      window.toastManager?.success?.('Copied to clipboard', { title: 'Copied', timeoutMs: 1800 });
    } catch {
      window.toastManager?.error?.('Failed to copy', { title: 'Copy failed' });
    }
  }

  async _loadHistory() {
    const validation = this._validateHistoryForm();
    if (!validation.ok) {
      this._setStatus('Fix highlighted fields.');
      return;
    }

    try {
      const {
        fromBlock,
        toBlock,
        toBlockRaw,
        creatorFilter,
        withdrawFilter,
      } = validation.values;
      const mineOnly = !!this.mineInput?.checked;
      const me = (window.walletManager?.getAddress?.() || '').toLowerCase();

      const provider = window.contractManager.getReadContract()?.provider || window.contractManager.getProvider?.();
      const contract = window.contractManager.getReadContract();
      if (!provider || !contract) throw new Error('Provider not ready');

      const iface = contract.interface;
      const eventTopic = iface.getEventTopic('LockClosed');
      const latest = toBlock === 'latest' ? await provider.getBlockNumber() : toBlock;

      const defaultFrom = Number(CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK || 0);
      const isDefaultFrom = Number.isFinite(defaultFrom) ? fromBlock === defaultFrom : fromBlock === 0;
      const isDefaultTo = !toBlockRaw;
      const useCache = isDefaultFrom && isDefaultTo && !creatorFilter && !withdrawFilter;
      const cached = useCache ? this._readHistoryCache() : null;
      const cachedEvents = Array.isArray(cached?.events) ? cached.events : [];

      const resumeFrom = useCache && Number.isFinite(cached?.lastScannedBlock)
        ? Math.max(fromBlock, cached.lastScannedBlock - HISTORY_CACHE_REORG_BUFFER)
        : fromBlock;

      const chunk = 3000;
      const freshEvents = [];
      for (let start = resumeFrom; start <= latest; start += chunk + 1) {
        const end = Math.min(latest, start + chunk);
        this._setStatus(`Scanning blocks ${start} - ${end}...`);
        const logs = await this._getLogsWithRetry(provider, {
          address: CONFIG.CONTRACT.ADDRESS,
          fromBlock: start,
          toBlock: end,
          topics: [eventTopic],
        });
        for (const log of logs) {
          try {
            const parsed = iface.parseLog(log);
            freshEvents.push(this._buildHistoryEvent(log, parsed.args));
          } catch {
            // ignore
          }
        }
        // Small pause between chunks to reduce burst pressure on public RPCs.
        await this._sleep(120);
      }

      const mergedEvents = useCache
        ? this._mergeHistoryEvents(cachedEvents, freshEvents)
        : freshEvents;

      if (useCache) {
        this._writeHistoryCache({
          lastScannedBlock: latest,
          events: mergedEvents,
        });
      }

      this._historyEvents = mergedEvents;
      this._lastProvider = provider;

      const displayEvents = this._filterHistoryEvents(mergedEvents, {
        mineOnly,
        me,
        creatorFilter,
        withdrawFilter,
      });

      await this._renderHistory(displayEvents, provider);
      this._setStatus(`Loaded ${displayEvents.length} closed locks.`);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load history'));
      window.toastManager?.error(msg, { title: 'History load failed' });
      this._setStatus('Load failed.');
    }
  }

  _validateHistoryForm() {
    clearFormErrors([this.fromInput, this.toInput, this.creatorInput, this.withdrawInput]);

    const fromRaw = (this.fromInput?.value || '').trim();
    const toRaw = (this.toInput?.value || '').trim();
    const creatorRaw = (this.creatorInput?.value || '').trim();
    const withdrawRaw = (this.withdrawInput?.value || '').trim();

    let ok = true;

    let fromBlock = 0;
    if (fromRaw) {
      const parsedFrom = Number(fromRaw);
      if (!Number.isFinite(parsedFrom) || parsedFrom < 0 || !Number.isInteger(parsedFrom)) {
        ok = false;
        setFieldError(this.fromInput, 'From block must be a whole number ≥ 0.');
      } else {
        fromBlock = parsedFrom;
      }
    }

    let toBlock = 'latest';
    if (toRaw) {
      const parsedTo = Number(toRaw);
      if (!Number.isFinite(parsedTo) || parsedTo < 0 || !Number.isInteger(parsedTo)) {
        ok = false;
        setFieldError(this.toInput, 'To block must be a whole number ≥ 0.');
      } else {
        toBlock = parsedTo;
      }
    }

    if (ok && toBlock !== 'latest' && Number.isFinite(fromBlock) && toBlock < fromBlock) {
      ok = false;
      setFieldError(this.toInput, 'To block must be greater than or equal to from block.');
    }

    let creatorFilter = creatorRaw.toLowerCase();
    if (creatorRaw) {
      const normalized = this._normalizeAddress(creatorRaw);
      if (!normalized) {
        ok = false;
        setFieldError(this.creatorInput, 'Creator address is not valid.');
      } else {
        creatorFilter = normalized.toLowerCase();
      }
    }

    let withdrawFilter = withdrawRaw.toLowerCase();
    if (withdrawRaw) {
      const normalized = this._normalizeAddress(withdrawRaw);
      if (!normalized) {
        ok = false;
        setFieldError(this.withdrawInput, 'Withdraw address is not valid.');
      } else {
        withdrawFilter = normalized.toLowerCase();
      }
    }

    if (!ok) return { ok };
    return {
      ok,
      values: {
        fromBlock,
        toBlock,
        toBlockRaw: toRaw,
        creatorFilter,
        withdrawFilter,
      },
    };
  }

  async _renderHistory(events, provider) {
    if (!this.listEl) return;
    if (!events.length) {
      this.listEl.innerHTML = '<p class="muted">No historical locks found.</p>';
      return;
    }

    // Sort newest first (by block)
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    await this._primeTokenMetadata(events);
    const uniqueBlocks = Array.from(
      new Set(events.map((e) => Number(e.blockNumber)).filter((n) => Number.isFinite(n) && n >= 0))
    );
    await this._prefetchBlockTimes(provider, uniqueBlocks, 2);

    const rows = [];
    for (const e of events) {
      const tokenAddr = String(e.token);
      const creator = String(e.creator || '');
      const withdrawAddress = String(e.withdrawAddress || '');
      const txHash = String(e.txHash || '');
      const tokenKey = tokenAddr.toLowerCase();
      const meta = this._tokenMeta.get(tokenKey) || (await this._getTokenMeta(tokenAddr));
      const fmt = (v) => window.ethers.utils.formatUnits(v || 0, meta.decimals || 18);
      const cachedClosedAt = this._blockTimeCache.get(e.blockNumber);
      const closedAt = cachedClosedAt == null ? await this._getBlockTime(provider, e.blockNumber) : cachedClosedAt;
      const reason = Number(e.reason) === 0 ? 'Withdrawn' : 'Retracted';
      const unlockTime = Number(e.unlockTime || 0);

      rows.push(`
        <div class="card lock-card">
          <div class="lock-header">
            <div>
              <h2 class="lock-title">Lock #${e.lockId}</h2>
              <p class="muted">${reason} • ${closedAt ? new Date(closedAt * 1000).toLocaleString() : 'Unknown time'}</p>
            </div>
          </div>
          <div class="lock-grid">
            <div class="lock-group">
              <div class="lock-group-title">Token and Balances</div>
              <div class="lock-kv">
                <div class="field-label">Token</div>
                <div class="field-input lock-address" title="${tokenAddr}">
                  <span>${meta.symbol || 'ERC20'} (${this._shortAddress(tokenAddr)})</span>
                  <button type="button" class="btn btn--ghost btn--icon" data-copy="${tokenAddr}" aria-label="Copy token address">
                    <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Amount</div>
                <div class="field-input">${fmt(e.amount)} ${meta.symbol}</div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Withdrawn</div>
                <div class="field-input">${fmt(e.withdrawn)} ${meta.symbol}</div>
              </div>
            </div>
            <div class="lock-group">
              <div class="lock-group-title">Schedule</div>
              <div class="lock-kv">
                <div class="field-label">Cliff Days</div>
                <div class="field-input">${e.cliffDays}</div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Rate Per Day</div>
                <div class="field-input">${e.ratePerDay}</div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Unlock Time</div>
                <div class="field-input">${unlockTime ? new Date(unlockTime * 1000).toLocaleString() : 'Not unlocked'}</div>
              </div>
            </div>
            <div class="lock-group">
              <div class="lock-group-title">Parties and Tx</div>
              <div class="lock-kv">
                <div class="field-label">Creator</div>
                <div class="field-input lock-address" title="${creator}">
                  <span>${this._shortAddress(creator)}</span>
                  <button type="button" class="btn btn--ghost btn--icon" data-copy="${creator}" aria-label="Copy creator address">
                    <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Withdraw Address</div>
                <div class="field-input lock-address" title="${withdrawAddress}">
                  <span>${this._shortAddress(withdrawAddress)}</span>
                  <button type="button" class="btn btn--ghost btn--icon" data-copy="${withdrawAddress}" aria-label="Copy withdraw address">
                    <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="lock-kv">
                <div class="field-label">Tx</div>
                <div class="field-input">${this._renderTxLink(txHash)}</div>
              </div>
            </div>
          </div>
        </div>
      `);
    }

    this.listEl.innerHTML = rows.join('');
  }

  async _applyHistoryFilters() {
    if (!this._historyEvents.length) return;
    const provider = this._lastProvider
      || window.contractManager.getReadContract()?.provider
      || window.contractManager.getProvider?.();
    if (!provider) return;

    const creatorFilter = (this.creatorInput?.value || '').trim().toLowerCase();
    const withdrawFilter = (this.withdrawInput?.value || '').trim().toLowerCase();
    const mineOnly = !!this.mineInput?.checked;
    const me = (window.walletManager?.getAddress?.() || '').toLowerCase();

    const displayEvents = this._filterHistoryEvents(this._historyEvents, {
      mineOnly,
      me,
      creatorFilter,
      withdrawFilter,
    });
    await this._renderHistory(displayEvents, provider);
    this._setStatus(`Loaded ${displayEvents.length} closed locks.`);
  }

  async _primeTokenMetadata(events = []) {
    const pending = [];
    Array.from(
      new Set(
        (events || [])
          .map((e) => String(e?.token || '').toLowerCase())
          .filter((addr) => addr && addr !== ZERO_ADDRESS)
      )
    ).forEach((addr) => {
      if (this._tokenMeta.has(addr)) return;
      const cached = readTokenMetaCache(addr);
      if (cached) {
        this._tokenMeta.set(addr, cached);
        return;
      }
      pending.push(addr);
    });
    if (!pending.length) return;

    try {
      const batchMap = await window.contractManager?.getTokenMetadataBatch?.(pending);
      if (batchMap instanceof Map) {
        pending.forEach((addr) => {
          const meta = batchMap.get(addr);
          const resolved = meta || { symbol: '', decimals: 18 };
          this._tokenMeta.set(addr, resolved);
          writeTokenMetaCache(addr, resolved);
        });
        return;
      }
    } catch {
      // Fall through to per-token fallback.
    }

    await Promise.all(pending.map(async (addr) => this._getTokenMeta(addr)));
  }

  async _prefetchBlockTimes(provider, blockNumbers = [], maxConcurrent = 4) {
    if (!provider) return;
    const pending = Array.from(
      new Set((blockNumbers || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0))
    ).filter((n) => !this._blockTimeCache.has(n));
    if (!pending.length) return;

    const concurrency = Math.max(1, Math.min(Number(maxConcurrent) || 1, pending.length));
    let index = 0;

    const worker = async () => {
      while (index < pending.length) {
        const i = index;
        index += 1;
        const blockNumber = pending[i];
        try {
          const block = await provider.getBlock(blockNumber);
          this._blockTimeCache.set(blockNumber, block?.timestamp || 0);
        } catch {
          this._blockTimeCache.set(blockNumber, 0);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  async _getLogsWithRetry(provider, filter, { maxRetries = 4, baseDelayMs = 400 } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await provider.getLogs(filter);
      } catch (err) {
        const retryable = this._isRateLimitError(err);
        if (!retryable || attempt >= maxRetries) throw err;
        const waitMs = baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * 120);
        this._setStatus(`Rate limited. Retrying in ${Math.ceil(waitMs / 1000)}s...`);
        await this._sleep(waitMs);
        attempt += 1;
      }
    }
  }

  _isRateLimitError(err) {
    const text = String(err?.message || err?.reason || err || '').toLowerCase();
    return (
      text.includes('429') ||
      text.includes('rate limit') ||
      text.includes('too many requests') ||
      text.includes('request limit') ||
      text.includes('throttl')
    );
  }

  async _sleep(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (!delay) return;
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  async _getTokenMeta(token) {
    const key = (token || '').toLowerCase();
    if (!key || key === ZERO_ADDRESS) return { symbol: '', decimals: 18 };
    if (this._tokenMeta.has(key)) return this._tokenMeta.get(key);
    const cached = readTokenMetaCache(key);
    if (cached) {
      this._tokenMeta.set(key, cached);
      return cached;
    }
    try {
      const meta = await window.contractManager.getTokenMetadata(token);
      const resolved = meta || { symbol: '', decimals: 18 };
      this._tokenMeta.set(key, resolved);
      writeTokenMetaCache(key, resolved);
    } catch {
      const fallback = { symbol: '', decimals: 18 };
      this._tokenMeta.set(key, fallback);
      writeTokenMetaCache(key, fallback);
    }
    return this._tokenMeta.get(key);
  }

  _filterHistoryEvents(events = [], { mineOnly, me, creatorFilter, withdrawFilter } = {}) {
    const meLower = String(me || '').toLowerCase();
    const creatorNeedle = String(creatorFilter || '').toLowerCase();
    const withdrawNeedle = String(withdrawFilter || '').toLowerCase();
    return (events || []).filter((e) => {
      const creator = String(e?.creator || '').toLowerCase();
      const withdrawAddress = String(e?.withdrawAddress || '').toLowerCase();
      if (mineOnly && meLower) {
        if (creator !== meLower && withdrawAddress !== meLower) return false;
      }
      if (creatorNeedle && creator !== creatorNeedle) return false;
      if (withdrawNeedle && withdrawAddress !== withdrawNeedle) return false;
      return true;
    });
  }

  _buildHistoryEvent(log, args) {
    const normalized = this._normalizeLockClosedArgs(args);
    return {
      blockNumber: Number(log?.blockNumber ?? 0),
      txHash: String(log?.transactionHash || ''),
      logIndex: Number(log?.logIndex ?? 0),
      ...normalized,
    };
  }

  _normalizeLockClosedArgs(args) {
    const val = (v, fallback = '0') => {
      if (v == null) return fallback;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v);
      if (typeof v?.toString === 'function') return v.toString();
      return fallback;
    };
    return {
      lockId: val(args?.lockId),
      reason: val(args?.reason),
      creator: String(args?.creator || ''),
      token: String(args?.token || ''),
      withdrawAddress: String(args?.withdrawAddress || ''),
      amount: val(args?.amount),
      withdrawn: val(args?.withdrawn),
      cliffDays: val(args?.cliffDays),
      ratePerDay: val(args?.ratePerDay),
      unlockTime: val(args?.unlockTime),
      unlocked: !!args?.unlocked,
    };
  }

  _mergeHistoryEvents(base = [], incoming = []) {
    const map = new Map();
    const insert = (e) => {
      const key = this._historyEventKey(e);
      map.set(key, e);
    };
    (base || []).forEach(insert);
    (incoming || []).forEach(insert);
    return Array.from(map.values());
  }

  _historyEventKey(e) {
    const txHash = String(e?.txHash || '');
    const logIndex = Number(e?.logIndex ?? -1);
    if (txHash && logIndex >= 0) return `${txHash}:${logIndex}`;
    const lockId = String(e?.lockId ?? '');
    const blockNumber = Number(e?.blockNumber ?? 0);
    return `${lockId}:${blockNumber}`;
  }

  _getHistoryCacheKey() {
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const address = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    if (!chainId || !address) return null;
    return `liberdus_token_ui:history:cache:v1:${chainId}:${address}`;
  }

  _readHistoryCache() {
    const key = this._getHistoryCacheKey();
    if (!key) return null;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const lastScannedBlock = Number(parsed.lastScannedBlock);
      const events = Array.isArray(parsed.events) ? parsed.events : [];
      return {
        lastScannedBlock: Number.isFinite(lastScannedBlock) ? lastScannedBlock : null,
        events,
      };
    } catch {
      return null;
    }
  }

  _writeHistoryCache({ lastScannedBlock, events } = {}) {
    const key = this._getHistoryCacheKey();
    if (!key) return;
    try {
      const payload = {
        lastScannedBlock: Number.isFinite(lastScannedBlock) ? Number(lastScannedBlock) : null,
        events: Array.isArray(events) ? events : [],
        savedAt: Date.now(),
      };
      window.localStorage?.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }


  async _getBlockTime(provider, blockNumber) {
    if (this._blockTimeCache.has(blockNumber)) return this._blockTimeCache.get(blockNumber);
    try {
      const block = await provider.getBlock(blockNumber);
      this._blockTimeCache.set(blockNumber, block?.timestamp || 0);
      return block?.timestamp || 0;
    } catch {
      this._blockTimeCache.set(blockNumber, 0);
      return 0;
    }
  }

  _shortAddress(value) {
    const s = String(value || '');
    if (!s) return '—';
    if (s.length < 10) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }

  _normalizeAddress(value) {
    if (!value) return '';
    try {
      return window.ethers.utils.getAddress(value);
    } catch {
      return '';
    }
  }

  _renderTxLink(txHash) {
    const hash = String(txHash || '');
    if (!hash) return '—';
    const explorer = CONFIG?.NETWORK?.BLOCK_EXPLORER || 'https://polygonscan.com';
    const txUrl = `${explorer}/tx/${hash}`;
    return `<a href="${txUrl}" target="_blank" rel="noopener noreferrer" title="${hash}">${this._shortAddress(hash)}</a>`;
  }

  _syncMineFilterFromWallet() {
    if (!this.mineInput) return;
    const wallet = (window.walletManager?.getAddress?.() || '').toLowerCase();
    const isConnected = !!wallet;
    const reason = 'Connect your wallet to use this filter.';
    this.mineInput.disabled = !isConnected;
    this.mineInput.title = isConnected ? '' : reason;
    if (!isConnected) {
      this.mineInput.checked = false;
      return;
    }
    this._restorePreferences();
  }

  _restorePreferences() {
    const key = this._getPreferencesKey();
    if (!key || !this.mineInput) return false;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed?.mineOnly == null) return false;
      this.mineInput.checked = !!parsed.mineOnly;
      return true;
    } catch {
      return false;
    }
  }

  _savePreferences() {
    const key = this._getPreferencesKey();
    if (!key || !this.mineInput) return;
    try {
      window.localStorage?.setItem(key, JSON.stringify({ mineOnly: !!this.mineInput.checked }));
    } catch {
      // Ignore storage errors
    }
  }

  _getPreferencesKey() {
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const address = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    const wallet = (window.walletManager?.getAddress?.() || '').toLowerCase();
    if (!chainId || !address || !wallet) return null;
    return `liberdus_token_ui:history:prefs:v1:${chainId}:${address}:${wallet}`;
  }
}

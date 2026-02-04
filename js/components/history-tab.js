import { CONFIG } from '../config.js';
import { extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class HistoryTab {
  constructor() {
    this.panel = null;
    this._loaded = false;
    this._tokenMeta = new Map();
    this._blockTimeCache = new Map();
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
            <summary class="history-advanced-summary">Advanced filters</summary>
            <div class="history-advanced-panel">
              <div class="form-grid history-advanced-grid">
              <label class="field">
                <span class="field-label">From block</span>
                <input class="field-input" data-history-from type="number" min="0" step="1" placeholder="0" />
              </label>
              <label class="field">
                <span class="field-label">To block</span>
                <input class="field-input" data-history-to type="number" min="0" step="1" placeholder="latest" />
              </label>
              <label class="field">
                <span class="field-label">Creator filter</span>
                <input class="field-input" data-history-creator placeholder="0x..." />
              </label>
              <label class="field">
                <span class="field-label">Withdraw address filter</span>
                <input class="field-input" data-history-withdraw placeholder="0x..." />
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
    this.panel?.addEventListener('click', (e) => this._handlePanelClick(e));
    this.mineInput?.addEventListener('change', () => this._savePreferences());

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
    try {
      const fromBlock = Number(this.fromInput?.value || 0);
      const toBlockRaw = (this.toInput?.value || '').trim();
      const toBlock = toBlockRaw ? Number(toBlockRaw) : 'latest';
      const creatorFilter = (this.creatorInput?.value || '').trim().toLowerCase();
      const withdrawFilter = (this.withdrawInput?.value || '').trim().toLowerCase();
      const mineOnly = !!this.mineInput?.checked;
      const me = (window.walletManager?.getAddress?.() || '').toLowerCase();

      if (!Number.isFinite(fromBlock) || fromBlock < 0) {
        throw new Error('Invalid from block');
      }
      if (toBlock !== 'latest' && (!Number.isFinite(toBlock) || toBlock < fromBlock)) {
        throw new Error('Invalid to block');
      }

      const provider = window.contractManager.getReadContract()?.provider || window.contractManager.getProvider?.();
      const contract = window.contractManager.getReadContract();
      if (!provider || !contract) throw new Error('Provider not ready');

      const iface = contract.interface;
      const eventTopic = iface.getEventTopic('LockClosed');
      const latest = toBlock === 'latest' ? await provider.getBlockNumber() : toBlock;

      const chunk = 5000;
      const events = [];
      for (let start = fromBlock; start <= latest; start += chunk + 1) {
        const end = Math.min(latest, start + chunk);
        this._setStatus(`Scanning blocks ${start} - ${end}...`);
        const logs = await provider.getLogs({
          address: CONFIG.CONTRACT.ADDRESS,
          fromBlock: start,
          toBlock: end,
          topics: [eventTopic],
        });
        for (const log of logs) {
          try {
            const parsed = iface.parseLog(log);
            const args = parsed.args;
            const creator = String(args.creator).toLowerCase();
            const withdrawAddress = String(args.withdrawAddress).toLowerCase();
            if (mineOnly && me) {
              if (creator !== me && withdrawAddress !== me) continue;
            }
            if (creatorFilter && creator !== creatorFilter) continue;
            if (withdrawFilter && withdrawAddress !== withdrawFilter) continue;
            events.push({
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              ...args,
            });
          } catch {
            // ignore
          }
        }
      }

      await this._renderHistory(events, provider);
      this._setStatus(`Loaded ${events.length} closed locks.`);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load history'));
      window.toastManager?.error(msg, { title: 'History load failed' });
      this._setStatus('Load failed.');
    }
  }

  async _renderHistory(events, provider) {
    if (!this.listEl) return;
    if (!events.length) {
      this.listEl.innerHTML = '<p class="muted">No historical locks found.</p>';
      return;
    }

    // Sort newest first (by block)
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    const rows = [];
    for (const e of events) {
      const tokenAddr = String(e.token);
      const creator = String(e.creator || '');
      const withdrawAddress = String(e.withdrawAddress || '');
      const txHash = String(e.txHash || '');
      const meta = await this._getTokenMeta(tokenAddr);
      const fmt = (v) => window.ethers.utils.formatUnits(v || 0, meta.decimals || 18);
      const closedAt = await this._getBlockTime(provider, e.blockNumber);
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

  async _getTokenMeta(token) {
    const key = (token || '').toLowerCase();
    if (!key || key === ZERO_ADDRESS) return { symbol: '', decimals: 18 };
    if (this._tokenMeta.has(key)) return this._tokenMeta.get(key);
    try {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta.set(key, meta || { symbol: '', decimals: 18 });
    } catch {
      this._tokenMeta.set(key, { symbol: '', decimals: 18 });
    }
    return this._tokenMeta.get(key);
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

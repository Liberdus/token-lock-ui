import { CONFIG } from '../config.js';

export class ParametersTab {
  constructor() {
    this.panel = null;
    this.refreshBtn = null;
    this._isLoading = false;

    // Phase 9.4: lazy tab loading
    this._isActive = false;
    this._needsRefresh = true;
    this._lastLoadedAt = 0;
    this._refreshDebounceTimer = null;
    this._autoRefreshTimer = null;
    this._autoRefreshIntervalMs = 60 * 1000;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="parameters"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <div class="card-title-row">
          <h2>Parameters</h2>
          <button type="button" class="btn btn--ghost btn--footer" data-params-refresh>Refresh</button>
        </div>
        <p class="muted">Read-only contract details and lock statistics.</p>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-title">Contract</div>
          <div class="kv-grid">
            <div class="kv kv--full">
              <div class="kv-label">Contract Address</div>
              <div class="kv-value">
                <div class="param-address">
                  <code data-param-contract-address>—</code>
                  <button type="button" class="copy-inline" data-copy-address data-address="">Copy</button>
                </div>
              </div>
            </div>
            <div class="kv">
              <div class="kv-label">Chain ID</div>
              <div class="kv-value" data-param-chain-id>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Deployment Block</div>
              <div class="kv-value" data-param-deploy-block>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Rate Scale</div>
              <div class="kv-value" data-param-rate-scale>—</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Locks</div>
          <div class="kv-grid">
            <div class="kv">
              <div class="kv-label">Next Lock ID</div>
              <div class="kv-value" data-param-next-lock-id>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Active Lock Count</div>
              <div class="kv-value" data-param-active-lock-count>—</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.refreshBtn = this.panel.querySelector('[data-params-refresh]');
    this.refreshBtn?.addEventListener('click', () => this.refresh({ forceRefresh: true }));

    this.panel.addEventListener('click', (e) => this._handleCopyClick(e));
    document.addEventListener('contractManagerUpdated', () => this._onContractManagerUpdated());

    document.addEventListener('tabActivated', (e) => {
      if (e?.detail?.tabName === 'parameters') this._onActivated();
    });
    document.addEventListener('tabDeactivated', (e) => {
      if (e?.detail?.tabName === 'parameters') this._onDeactivated();
    });
  }

  _onActivated() {
    this._isActive = true;
    // Refresh if stale or never loaded.
    const stale = !this._lastLoadedAt || Date.now() - this._lastLoadedAt > 30 * 1000;
    if (this._needsRefresh || stale) {
      this._scheduleRefresh({ forceRefresh: this._needsRefresh });
    }

    // Refresh dynamic values while active (Phase 9.3 / 9.6).
    if (!this._autoRefreshTimer) {
      this._autoRefreshTimer = setInterval(() => {
        if (!this._isActive) return;
        this.refresh({ forceRefresh: false, silent: true }).catch(() => {});
      }, this._autoRefreshIntervalMs);
    }
  }

  _onDeactivated() {
    this._isActive = false;
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
  }

  _onContractManagerUpdated() {
    // Mark stale; refresh only if tab is active to avoid background RPC calls.
    this._needsRefresh = true;
    if (this._isActive) {
      this._scheduleRefresh({ forceRefresh: true });
    }
  }

  _scheduleRefresh({ forceRefresh = false } = {}) {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      this.refresh({ forceRefresh }).catch(() => {});
    }, 200);
  }

  async refresh({ forceRefresh = false, silent = false } = {}) {
    if (this._isLoading) return;
    this._isLoading = true;
    if (!silent && this.refreshBtn) {
      this.refreshBtn.disabled = true;
      this.refreshBtn.textContent = 'Refreshing…';
    }

    try {
      await this._loadParameters({ forceRefresh });
      this._lastLoadedAt = Date.now();
      this._needsRefresh = false;
    } finally {
      this._isLoading = false;
      if (!silent && this.refreshBtn) {
        this.refreshBtn.disabled = false;
        this.refreshBtn.textContent = 'Refresh';
      }
    }
  }

  async _loadParameters({ forceRefresh = false } = {}) {
    const contractManager = window.contractManager;
    const contract = contractManager?.getReadContract?.();
    if (!contract) {
      this._setText('[data-param-chain-id]', CONFIG?.NETWORK?.CHAIN_ID ?? '—');
      this._setText('[data-param-deploy-block]', CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK ?? '—');
      this._setText('[data-param-rate-scale]', '—');
      this._setText('[data-param-next-lock-id]', '—');
      this._setText('[data-param-active-lock-count]', '—');
      this._renderAddress('[data-param-contract-address]', CONFIG?.CONTRACT?.ADDRESS || '');
      return;
    }

    const [
      chainId,
      rateScale,
      nextLockId,
      activeLockCount,
    ] = await Promise.all([
      this._safeCall(contract, 'chainId'),
      this._safeCall(contract, 'RATE_SCALE'),
      this._safeCall(contract, 'nextLockId'),
      this._safeCall(contract, 'getActiveLockCount'),
    ]);

    const chainIdValue = chainId != null ? Number(chainId.toString?.() ?? chainId) : CONFIG?.NETWORK?.CHAIN_ID;
    this._setText('[data-param-chain-id]', chainIdValue ?? '—');
    this._setText('[data-param-deploy-block]', CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK ?? '—');
    this._setText('[data-param-rate-scale]', rateScale != null ? String(rateScale.toString?.() ?? rateScale) : '—');
    this._setText('[data-param-next-lock-id]', nextLockId != null ? String(nextLockId.toString?.() ?? nextLockId) : '—');
    this._setText('[data-param-active-lock-count]', activeLockCount != null ? String(activeLockCount.toString?.() ?? activeLockCount) : '—');

    this._renderAddress('[data-param-contract-address]', CONFIG?.CONTRACT?.ADDRESS || '');
  }

  _setText(selector, value) {
    const el = this.panel?.querySelector(selector);
    if (el) el.textContent = value ?? '—';
  }

  _renderAddress(selector, address) {
    const el = this.panel?.querySelector(selector);
    if (!el) return;
    const addr = normalizeAddress(address);
    const display = addr ? shortAddress(addr) : '—';
    
    if (addr) {
      // Create clickable link to block explorer
      const explorer = CONFIG?.NETWORK?.BLOCK_EXPLORER || 'https://polygonscan.com';
      const explorerUrl = `${explorer}/address/${addr}`;
      el.innerHTML = `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" title="${addr}">${display}</a>`;
    } else {
      el.textContent = display;
      el.removeAttribute('title');
    }
    
    const copyBtn = el.closest('.param-address')?.querySelector('[data-copy-address]');
    if (copyBtn) {
      copyBtn.dataset.address = addr || '';
      copyBtn.disabled = !addr;
    }
  }


  async _handleCopyClick(e) {
    const btn = e.target?.closest?.('[data-copy-address]');
    if (!btn) return;
    const address = btn.dataset.address || '';
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      this._showCopyFeedback(btn);
      window.toastManager?.success?.('Address copied to clipboard', { timeoutMs: 2000 });
    } catch {
      window.toastManager?.error?.('Failed to copy address');
    }
  }

  _showCopyFeedback(button) {
    if (!button) return;
    button.classList.add('success');
    setTimeout(() => {
      button.classList.remove('success');
    }, 1500);
  }

  async _safeCall(contract, fnName) {
    if (!contract || typeof contract[fnName] !== 'function') return null;
    try {
      return await contract[fnName]();
    } catch {
      return null;
    }
  }
}

function normalizeAddress(addr) {
  if (!addr) return '';
  try {
    return window.ethers.utils.getAddress(String(addr));
  } catch {
    return String(addr);
  }
}

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}


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
        <p class="muted">Read-only contract details and signer configuration.</p>
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
              <div class="kv-label">Required Signatures</div>
              <div class="kv-value" data-param-required-sigs>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Launch State</div>
              <div class="kv-value" data-param-launch-state>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Paused</div>
              <div class="kv-value" data-param-paused>—</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Signers</div>
          <div class="param-list" data-param-signers>
            <div class="param-row muted">Loading…</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Bridge</div>
          <div class="kv-grid">
            <div class="kv kv--full">
              <div class="kv-label">Bridge-in Caller</div>
              <div class="kv-value">
                <div class="param-address">
                  <code data-param-bridge-caller>—</code>
                  <button type="button" class="copy-inline" data-copy-address data-address="">Copy</button>
                </div>
              </div>
            </div>
            <div class="kv">
              <div class="kv-label">Max Bridge-in Amount</div>
              <div class="kv-value" data-param-bridge-max>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Bridge-in Cooldown</div>
              <div class="kv-value" data-param-bridge-cooldown>—</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Minting</div>
          <div class="kv-grid">
            <div class="kv">
              <div class="kv-label">Last Mint Time</div>
              <div class="kv-value" data-param-last-mint>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Mint Interval</div>
              <div class="kv-value" data-param-mint-interval>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Max Supply</div>
              <div class="kv-value" data-param-max-supply>—</div>
            </div>
            <div class="kv">
              <div class="kv-label">Mint Amount</div>
              <div class="kv-value" data-param-mint-amount>—</div>
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
      this._setText('[data-param-required-sigs]', '—');
      this._setText('[data-param-launch-state]', 'Not available');
      this._setText('[data-param-paused]', 'Not available');
      this._setText('[data-param-bridge-max]', '—');
      this._setText('[data-param-bridge-cooldown]', '—');
      this._setText('[data-param-last-mint]', '—');
      this._setText('[data-param-mint-interval]', '—');
      this._setText('[data-param-max-supply]', '—');
      this._setText('[data-param-mint-amount]', '—');
      this._renderAddress('[data-param-contract-address]', CONFIG?.CONTRACT?.ADDRESS || '');
      this._renderAddress('[data-param-bridge-caller]', '');
      this._renderSigners([]);
      return;
    }

    // Prefer batched reads to reduce RPC call count.
    if (typeof contractManager?.getParametersBatch === 'function') {
      try {
        const batch = await contractManager.getParametersBatch({ forceRefresh: !!forceRefresh });
        if (batch) {
          const chainId = batch.chainId;
          const requiredSigs = batch.requiredSignatures;
          const isPreLaunch = batch.isPreLaunch;
          const paused = batch.paused;
          const bridgeInCaller = batch.bridgeInCaller;
          const maxBridgeInAmount = batch.maxBridgeInAmount;
          const bridgeInCooldown = batch.bridgeInCooldown;
          const lastMintTime = batch.lastMintTime;
          const mintInterval = batch.mintInterval;
          const maxSupply = batch.maxSupply;
          const mintAmount = batch.mintAmount;
          const signers = Array.isArray(batch.signers) ? batch.signers : [];

          const chainIdValue = chainId != null ? Number(chainId.toString?.() ?? chainId) : CONFIG?.NETWORK?.CHAIN_ID;
          this._setText('[data-param-chain-id]', chainIdValue ?? '—');
          this._setText('[data-param-required-sigs]', requiredSigs != null ? Number(requiredSigs.toString?.() ?? requiredSigs) : '—');
          this._setText('[data-param-launch-state]', isPreLaunch == null ? '—' : (isPreLaunch ? 'Pre-launch' : 'Post-launch'));
          this._setText('[data-param-paused]', paused == null ? '—' : (paused ? 'Yes' : 'No'));

          this._renderAddress('[data-param-contract-address]', CONFIG?.CONTRACT?.ADDRESS || '');
          this._renderAddress('[data-param-bridge-caller]', bridgeInCaller);

          this._setText('[data-param-bridge-max]', formatLib(maxBridgeInAmount));
          this._setText('[data-param-bridge-cooldown]', formatDuration(bridgeInCooldown));
          this._setText('[data-param-last-mint]', formatTimestamp(lastMintTime));
          this._setText('[data-param-mint-interval]', formatDuration(mintInterval));
          this._setText('[data-param-max-supply]', formatLib(maxSupply));
          this._setText('[data-param-mint-amount]', formatLib(mintAmount));

          this._renderSigners(signers);
          return;
        }
      } catch {
        // Fall through to per-call fallback
      }
    }

    const [
      chainId,
      requiredSigs,
      isPreLaunch,
      paused,
      bridgeInCaller,
      maxBridgeInAmount,
      bridgeInCooldown,
      lastMintTime,
      mintInterval,
      maxSupply,
      mintAmount,
      signers,
    ] = await Promise.all([
      this._safeCall(contract, 'chainId'),
      this._safeCall(contract, 'REQUIRED_SIGNATURES'),
      this._safeCall(contract, 'isPreLaunch'),
      this._safeCall(contract, 'paused'),
      this._safeCall(contract, 'bridgeInCaller'),
      this._safeCall(contract, 'maxBridgeInAmount'),
      this._safeCall(contract, 'bridgeInCooldown'),
      this._safeCall(contract, 'lastMintTime'),
      this._safeCall(contract, 'MINT_INTERVAL'),
      this._safeCall(contract, 'MAX_SUPPLY'),
      this._safeCall(contract, 'MINT_AMOUNT'),
      this._loadSigners(contract),
    ]);

    const chainIdValue = chainId != null ? Number(chainId.toString?.() ?? chainId) : CONFIG?.NETWORK?.CHAIN_ID;
    this._setText('[data-param-chain-id]', chainIdValue ?? '—');
    this._setText('[data-param-required-sigs]', requiredSigs != null ? Number(requiredSigs.toString?.() ?? requiredSigs) : '—');
    this._setText('[data-param-launch-state]', isPreLaunch == null ? '—' : (isPreLaunch ? 'Pre-launch' : 'Post-launch'));
    this._setText('[data-param-paused]', paused == null ? '—' : (paused ? 'Yes' : 'No'));

    this._renderAddress('[data-param-contract-address]', CONFIG?.CONTRACT?.ADDRESS || '');
    this._renderAddress('[data-param-bridge-caller]', bridgeInCaller);

    this._setText('[data-param-bridge-max]', formatLib(maxBridgeInAmount));
    this._setText('[data-param-bridge-cooldown]', formatDuration(bridgeInCooldown));
    this._setText('[data-param-last-mint]', formatTimestamp(lastMintTime));
    this._setText('[data-param-mint-interval]', formatDuration(mintInterval));
    this._setText('[data-param-max-supply]', formatLib(maxSupply));
    this._setText('[data-param-mint-amount]', formatLib(mintAmount));

    this._renderSigners(signers);
  }

  async _loadSigners(contract) {
    if (typeof contract.signers !== 'function') return [];
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      try {
        const addr = await contract.signers(i);
        if (addr) out.push(addr);
      } catch {
        break;
      }
    }
    return out;
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

  _renderSigners(signers) {
    const container = this.panel?.querySelector('[data-param-signers]');
    if (!container) return;
    if (!signers || signers.length === 0) {
      container.innerHTML = `<div class="param-row muted">No signers found.</div>`;
      return;
    }
    container.innerHTML = signers
      .map((addr) => {
        const full = normalizeAddress(addr);
        const short = full ? shortAddress(full) : '—';
        const titleAttr = full ? ` title="${full}"` : '';
        const dataAttr = full ? ` data-address="${full}"` : '';
        return `
          <div class="param-row">
            <div class="param-address">
              <code${titleAttr}>${short}</code>
              <button type="button" class="copy-inline" data-copy-address${dataAttr}>Copy</button>
            </div>
          </div>
        `;
      })
      .join('');
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

function formatTimestamp(value) {
  if (value == null) return '—';
  const seconds = Number(value.toString?.() ?? value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return new Date(seconds * 1000).toLocaleString();
}

function formatDuration(value) {
  if (value == null) return '—';
  const seconds = Number(value.toString?.() ?? value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const parts = [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}m` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : `${seconds}s`;
}

function formatLib(value) {
  if (value == null) return '—';
  try {
    const contractManager = window.contractManager;
    const symbol = contractManager?.getTokenSymbol?.();
    const s = window.ethers.utils.formatEther(value);
    const trimmed = trimZeros(s);
    return symbol ? `${trimmed} ${symbol}` : trimmed;
  } catch {
    return '—';
  }
}

function trimZeros(raw) {
  if (!raw || !raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '');
}

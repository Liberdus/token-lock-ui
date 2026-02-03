import { CONFIG } from '../config.js';

export class BridgeTab {
  constructor() {
    this.panel = null;

    this.modeSelect = null;
    this.addrWrap = null;
    this.addrLabel = null;
    this.addrInput = null;
    this.amountWrap = null;
    this.amountInput = null;
    this.txIdWrap = null;
    this.txIdInput = null;
    this.infoEl = null;
    this.submitBtn = null;
    this.summaryEl = null;

    this._mode = 'out'; // 'out' | 'in'
    this._bridgeInCaller = null;
    this._isSubmitting = false;

    // Phase 9.4: lazy tab loading
    this._isActive = false;
    this._bridgeConfigLoadedAt = 0;
    this._bridgeConfigTtlMs = 60 * 1000;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="bridge"]');
    if (!this.panel) return;

    // Get symbol dynamically from contract manager (only use if available from contract)
    const contractManager = window.contractManager;
    const symbol = contractManager?.getTokenSymbol?.();
    const symbolText = symbol || 'tokens';
    const symbolDisplay = symbol ? `<strong>${symbol}</strong>` : 'tokens';

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Bridge</h2>
        <p class="muted">Bridge tokens in/out.</p>
        <ul class="list">
          <li>Transactions are only enabled when MetaMask is connected on Polygon.</li>
          <li>Amounts are entered in ${symbolDisplay} (18 decimals).</li>
        </ul>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field field--full">
            <span class="field-label">Bridge Type</span>
            <select class="field-input" data-requires-tx="true" data-bridge-mode>
              <option value="">Select bridge type…</option>
              <option value="out">Bridge Out (${symbolText} → coin)</option>
              <option value="in">Bridge In (coin → ${symbolText})</option>
            </select>
          </label>

          <div class="field field--full" data-bridge-summary style="display: none;">
            <p class="muted" style="margin: 0; font-size: var(--font-size-sm);"></p>
          </div>

          <label class="field" data-bridge-addr-wrap>
            <span class="field-label" data-bridge-addr-label>Target address</span>
            <input class="field-input" type="text" placeholder="0x…" data-requires-tx="true" data-bridge-addr />
          </label>

          <label class="field" data-bridge-amount-wrap>
            <span class="field-label">Amount (${symbolText})</span>
            <input class="field-input" type="text" placeholder="0" data-requires-tx="true" data-bridge-amount />
          </label>

          <label class="field field--full" data-bridge-txid-wrap>
            <span class="field-label">TxId (bridge in only)</span>
            <input class="field-input" type="text" placeholder="0x… (bytes32)" data-requires-tx="true" data-bridge-txid />
          </label>
        </div>

        <div class="muted" data-bridge-info></div>

        <div class="actions">
          <button type="button" class="btn btn--primary" data-requires-tx="true" data-bridge-submit>
            Submit
          </button>
        </div>
      </div>
    `;

    this.modeSelect = this.panel.querySelector('[data-bridge-mode]');
    this.summaryEl = this.panel.querySelector('[data-bridge-summary]');
    this.addrWrap = this.panel.querySelector('[data-bridge-addr-wrap]');
    this.addrLabel = this.panel.querySelector('[data-bridge-addr-label]');
    this.addrInput = this.panel.querySelector('[data-bridge-addr]');
    this.amountWrap = this.panel.querySelector('[data-bridge-amount-wrap]');
    this.amountInput = this.panel.querySelector('[data-bridge-amount]');
    this.txIdWrap = this.panel.querySelector('[data-bridge-txid-wrap]');
    this.txIdInput = this.panel.querySelector('[data-bridge-txid]');
    this.infoEl = this.panel.querySelector('[data-bridge-info]');
    this.submitBtn = this.panel.querySelector('[data-bridge-submit]');

    this.modeSelect?.addEventListener('change', () => this._onModeChange());
    this.submitBtn?.addEventListener('click', () => this._onSubmit());

    this._onModeChange();
    window.networkManager?.updateUIState?.();

    document.addEventListener('tabActivated', (e) => {
      if (e?.detail?.tabName === 'bridge') this._onActivated();
    });
    document.addEventListener('tabDeactivated', (e) => {
      if (e?.detail?.tabName === 'bridge') this._onDeactivated();
    });
  }

  _onActivated() {
    this._isActive = true;
    const fresh = this._bridgeConfigLoadedAt && Date.now() - this._bridgeConfigLoadedAt < this._bridgeConfigTtlMs;
    if (!fresh) {
      this._loadBridgeConfig().catch(() => {});
    } else {
      this._updateInfo();
    }
  }

  _onDeactivated() {
    this._isActive = false;
  }

  _onModeChange() {
    const v = this.modeSelect?.value || '';
    this._mode = v === 'in' ? 'in' : (v === 'out' ? 'out' : null);

    // Clear inputs when switching modes
    if (this.addrInput) this.addrInput.value = '';
    if (this.amountInput) this.amountInput.value = '';
    if (this.txIdInput) this.txIdInput.value = '';

    // Show/hide and set summary
    const summaryText = this.summaryEl?.querySelector('p');
    if (!this._mode) {
      // No bridge type selected
      if (this.summaryEl) this.summaryEl.style.display = 'none';
      if (this.addrWrap) this.addrWrap.classList.add('hidden');
      if (this.amountWrap) this.amountWrap.classList.add('hidden');
      if (this.txIdWrap) this.txIdWrap.classList.add('hidden');
      if (this.submitBtn) this.submitBtn.disabled = true;
    } else {
      if (this.summaryEl) this.summaryEl.style.display = 'block';
      if (this.addrWrap) this.addrWrap.classList.remove('hidden');
      if (this.amountWrap) this.amountWrap.classList.remove('hidden');
      if (this.submitBtn) this.submitBtn.disabled = false;

      // Prefill address with connected wallet (if available)
      const me = window.walletManager?.getAddress?.() || '';
      if (me && this.addrInput) this.addrInput.value = me;

      if (this._mode === 'out') {
        if (summaryText) summaryText.textContent = 'Burns LIB tokens from your wallet and emits an on-chain event for cross-chain bridging (post-launch only).';
        if (this.addrLabel) this.addrLabel.textContent = 'Target address (where you want coins credited)';
        this.txIdWrap?.classList.add('hidden');
        this.txIdInput && (this.txIdInput.disabled = true);
      } else {
        if (summaryText) summaryText.textContent = 'Mints LIB tokens to a recipient address from a cross-chain transfer (post-launch only, requires bridgeInCaller authorization).';
        if (this.addrLabel) this.addrLabel.textContent = 'Recipient address (to receive LIB)';
        this.txIdWrap?.classList.remove('hidden');
        this.txIdInput && (this.txIdInput.disabled = false);
      }
    }

    this._updateInfo();
  }

  async _loadBridgeConfig() {
    const contractManager = window.contractManager;
    const read = contractManager?.getReadContract?.();
    if (!read) return;

    try {
      // Prefer batched parameters (reduces duplicate calls when Parameters tab also loads).
      let caller = null;
      if (typeof contractManager?.getParametersBatch === 'function') {
        try {
          const batch = await contractManager.getParametersBatch();
          caller = batch?.bridgeInCaller ?? null;
        } catch {
          // ignore
        }
      }
      if (caller == null && typeof read.bridgeInCaller === 'function') {
        caller = await read.bridgeInCaller();
      }
      this._bridgeInCaller = caller ? String(caller) : null;
      this._bridgeConfigLoadedAt = Date.now();
    } catch {
      this._bridgeInCaller = null;
    }

    this._updateInfo();
  }

  _updateInfo() {
    if (!this.infoEl) return;

    const txEnabled = !!window.networkManager?.isTxEnabled?.();
    const me = String(window.walletManager?.getAddress?.() || '').toLowerCase();
    const caller = String(this._bridgeInCaller || '').toLowerCase();

    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);

    if (!txEnabled) {
      this.infoEl.innerHTML = `Connect MetaMask on Polygon to enable bridge transactions.`;
      return;
    }

    if (this._mode === 'in') {
      if (!caller) {
        this.infoEl.innerHTML = `Bridge in caller: <code>unknown</code>. Only this address can call <code>bridgeIn</code>.`;
        return;
      }
      const ok = me && caller && me === caller;
      this.infoEl.innerHTML = `Bridge in caller: <code>${this._bridgeInCaller}</code> • ChainId: <code>${chainId}</code>` +
        (ok ? '' : `<br/>Your wallet is not the bridge caller; this will revert.`);
      return;
    }

    this.infoEl.innerHTML = `ChainId: <code>${chainId}</code> • Bridge out burns LIB from your wallet.`;
  }

  async _onSubmit() {
    if (this._isSubmitting) return;

    const toast = window.toastManager;
    const networkManager = window.networkManager;
    const contractManager = window.contractManager;

    if (!networkManager?.isTxEnabled?.()) {
      toast?.error?.('Connect MetaMask on Polygon to submit bridge transactions.');
      return;
    }

    const write = contractManager?.getWriteContract?.();
    const read = contractManager?.getReadContract?.();
    const me = window.walletManager?.getAddress?.();
    if (!write || !read || !me) {
      toast?.error?.('Wallet/contract not ready.');
      return;
    }

    // Common pre-checks
    try {
      const isPreLaunch = await read.isPreLaunch();
      if (isPreLaunch) {
        toast?.error?.('Bridge is not available in pre-launch mode.');
        return;
      }
    } catch {
      // ignore
    }

    try {
      const paused = await read.paused?.();
      if (paused) {
        toast?.error?.('Contract is paused.');
        return;
      }
    } catch {
      // ignore (older ABI may not expose paused)
    }

    let addr = null;
    let amountWei = null;
    let txId = null;
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);

    try {
      addr = this._readAddress();
      amountWei = this._readAmountWei();
      txId = this._mode === 'in' ? this._readTxId() : null;
    } catch (e) {
      toast?.error?.(e?.message || 'Invalid inputs.');
      return;
    }

    if (this._mode === 'in') {
      // Authorization check: only bridgeInCaller
      const caller = String(this._bridgeInCaller || '').toLowerCase();
      if (!caller) {
        try {
          const c = await read.bridgeInCaller();
          this._bridgeInCaller = String(c);
        } catch {
          // ignore
        }
      }
      if (String(me).toLowerCase() !== String(this._bridgeInCaller || '').toLowerCase()) {
        toast?.error?.('Not authorized: only the configured bridgeInCaller can call bridge in.');
        return;
      }
    }

    this._isSubmitting = true;
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = 'Submitting…';
    }

    const loadingId = toast?.loading?.(this._mode === 'out' ? 'Submitting bridge out…' : 'Submitting bridge in…', {
      id: 'bridge-submit',
      delayMs: 100,
    });

    try {
      let tx;
      if (this._mode === 'out') {
        tx = await write.bridgeOut(amountWei, addr, chainId);
      } else {
        tx = await write.bridgeIn(addr, amountWei, chainId, txId);
      }

      toast?.update?.(loadingId, {
        type: 'loading',
        title: 'Transaction sent',
        message: 'Waiting for confirmation…',
        dismissible: false,
        timeoutMs: 0,
      });

      await tx.wait();
      contractManager?.invalidateParametersCache?.({ notify: true });

      const explorer = CONFIG?.NETWORK?.BLOCK_EXPLORER || 'https://polygonscan.com';
      toast?.update?.(loadingId, {
        type: 'success',
        title: 'Success',
        message: `Tx: ${explorer}/tx/${tx.hash}`,
        dismissible: true,
        timeoutMs: 7000,
      });
    } catch (e) {
      toast?.update?.(loadingId, {
        type: 'error',
        title: 'Bridge failed',
        message: e?.data?.message || e?.message || 'Bridge transaction failed',
        dismissible: true,
        timeoutMs: 0,
      });
    } finally {
      this._isSubmitting = false;
      if (this.submitBtn) {
        this.submitBtn.textContent = 'Submit';
        this.submitBtn.disabled = false;
        window.networkManager?.updateUIState?.();
      }
      this._updateInfo();
    }
  }

  _readAddress() {
    const raw = String(this.addrInput?.value || '').trim();
    if (!raw) throw new Error('Enter an address.');
    try {
      return window.ethers.utils.getAddress(raw);
    } catch {
      throw new Error('Invalid address.');
    }
  }

  _readAmountWei() {
    const raw = String(this.amountInput?.value || '').trim();
    if (!raw) throw new Error('Enter an amount.');
    try {
      const bn = window.ethers.utils.parseEther(raw);
      if (bn.lte(0)) throw new Error('zero');
      return bn;
    } catch {
      throw new Error('Invalid amount.');
    }
  }

  _readTxId() {
    const raw = String(this.txIdInput?.value || '').trim();
    if (!raw) throw new Error('Enter a txId (bytes32).');
    if (!window.ethers.utils.isHexString(raw, 32)) {
      throw new Error('Invalid txId: expected 32-byte hex string (0x… length 66).');
    }
    return raw;
  }
}


import { CONFIG } from '../config.js';
import { formatTxMessage, extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';

export class ProposeTab {
  constructor() {
    this.panel = null;
    this.typeSelect = null;
    this.targetWrap = null;
    this.targetInput = null;
    this.valueWrap = null;
    this.valueInput = null;
    this.dataWrap = null;
    this.dataInput = null;
    this.submitBtn = null;
    this.summaryEl = null;

    // Mint readiness (liberdus-sc-dao parity)
    this.mintReadinessWrap = null;
    this.mintLastDateEl = null;
    this.mintStatusEl = null;
    this.mintCountdownWrap = null;
    this.mintCountdownEl = null;
    this.mintReadyDateWrap = null;
    this.mintReadyDateEl = null;
    this._mintLastMintSec = null; // number (unix seconds)
    this._mintCountdownTimer = null;
    this._mintLastFetchAt = 0;
    this._mintFetchTtlMs = 30 * 1000;
    this._mintChainRefreshTimer = null;
    this._mintChainRefreshIntervalMs = 60 * 1000;
    // 3 weeks + 6 days + 9 hours (matches liberdus-sc-dao)
    this._mintIntervalSec =
      BigInt(3 * 7 * 24 * 60 * 60) + BigInt(6 * 24 * 60 * 60) + BigInt(9 * 60 * 60);

    this._isSubmitting = false;

    // Phase 9.4: lazy tab loading
    this._isActive = false;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="propose"]');
    if (!this.panel) return;

    // Get symbol dynamically from contract manager (only use if available from contract)
    const contractManager = window.contractManager;
    const symbol = contractManager?.getTokenSymbol?.();
    const symbolText = symbol ? `<strong>${symbol}</strong>` : 'tokens';

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Propose</h2>
        <p class="muted">Request a new operation. <strong>Only signers/owner</strong> can submit.</p>
        <ul class="list">
          <li>Transactions are only enabled when MetaMask is connected on Polygon.</li>
          <li>Amounts are entered in ${symbolText} (18 decimals) unless stated otherwise.</li>
        </ul>
      </div>

      <div class="mint-readiness" data-mint-readiness>
        <div class="mint-readiness-content">
          <div class="mint-readiness-row">
            <span class="mint-readiness-label">Last Mint:</span>
            <span class="mint-readiness-value" data-mint-last-date>—</span>
          </div>
          <div class="mint-readiness-row">
            <span class="mint-readiness-label">Status:</span>
            <span class="mint-readiness-value" data-mint-status style="color: var(--secondary-text-color);">Loading…</span>
          </div>
          <div class="mint-readiness-row" data-mint-countdown-wrap style="display: none;">
            <span class="mint-readiness-label">Time Remaining:</span>
            <span class="mint-readiness-value" data-mint-countdown style="color: var(--danger-color);">—</span>
          </div>
          <div class="mint-readiness-row" data-mint-ready-date-wrap style="display: none;">
            <span class="mint-readiness-label">Ready Date:</span>
            <span class="mint-readiness-value" data-mint-ready-date style="color: var(--secondary-text-color);">—</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field field--full">
            <span class="field-label">Operation Type</span>
            <select class="field-input" data-requires-tx="true" data-propose-optype>
              <option value="">Select an operation…</option>
            </select>
          </label>

          <div class="field field--full" data-propose-summary style="display: none;">
            <p class="muted" style="margin: 0; font-size: var(--font-size-sm);"></p>
          </div>

          <label class="field" data-propose-target-wrap>
            <span class="field-label" data-propose-target-label>Target</span>
            <input class="field-input" type="text" placeholder="0x…" data-requires-tx="true" data-propose-target />
          </label>

          <label class="field" data-propose-value-wrap>
            <span class="field-label" data-propose-value-label>Value</span>
            <input class="field-input" type="text" placeholder="0" data-requires-tx="true" data-propose-value />
          </label>

          <label class="field field--full" data-propose-data-wrap>
            <span class="field-label" data-propose-data-label>Data</span>
            <input class="field-input" type="text" placeholder="0x" data-requires-tx="true" data-propose-data />
          </label>
        </div>

        <div class="actions">
          <button type="button" class="btn btn--primary" data-requires-tx="true" data-propose-submit>
            Request Operation
          </button>
        </div>
      </div>
    `;

    this.typeSelect = this.panel.querySelector('[data-propose-optype]');
    this.summaryEl = this.panel.querySelector('[data-propose-summary]');
    this.targetWrap = this.panel.querySelector('[data-propose-target-wrap]');
    this.targetInput = this.panel.querySelector('[data-propose-target]');
    this.valueWrap = this.panel.querySelector('[data-propose-value-wrap]');
    this.valueInput = this.panel.querySelector('[data-propose-value]');
    this.dataWrap = this.panel.querySelector('[data-propose-data-wrap]');
    this.dataInput = this.panel.querySelector('[data-propose-data]');
    this.submitBtn = this.panel.querySelector('[data-propose-submit]');
    this.mintReadinessWrap = this.panel.querySelector('[data-mint-readiness]');
    this.mintLastDateEl = this.panel.querySelector('[data-mint-last-date]');
    this.mintStatusEl = this.panel.querySelector('[data-mint-status]');
    this.mintCountdownWrap = this.panel.querySelector('[data-mint-countdown-wrap]');
    this.mintCountdownEl = this.panel.querySelector('[data-mint-countdown]');
    this.mintReadyDateWrap = this.panel.querySelector('[data-mint-ready-date-wrap]');
    this.mintReadyDateEl = this.panel.querySelector('[data-mint-ready-date]');

    this._populateOpTypes();
    this.typeSelect?.addEventListener('change', () => this._onOperationTypeChange());
    this.submitBtn?.addEventListener('click', () => this._onSubmit());

    this._onOperationTypeChange();
    window.networkManager?.updateUIState?.();

    document.addEventListener('tabActivated', (e) => {
      if (e?.detail?.tabName === 'propose') this._onActivated();
    });
    document.addEventListener('tabDeactivated', (e) => {
      if (e?.detail?.tabName === 'propose') this._onDeactivated();
    });
  }

  _onActivated() {
    this._isActive = true;

    // Refresh from chain periodically while active (dynamic value).
    if (!this._mintChainRefreshTimer) {
      this._mintChainRefreshTimer = setInterval(async () => {
        if (!this._isActive) return;
        try {
          await this._refreshMintReadinessFromChain();
          this._mintLastFetchAt = Date.now();
          this._renderMintReadiness();
        } catch {
          // ignore
        }
      }, this._mintChainRefreshIntervalMs);
    }

    // If we already have lastMintTime and it's still fresh, just resume countdown.
    const fresh = this._mintLastFetchAt && Date.now() - this._mintLastFetchAt < this._mintFetchTtlMs;
    if (fresh && this._mintLastMintSec) {
      // Ensure we don't create multiple timers
      if (this._mintCountdownTimer) {
        clearInterval(this._mintCountdownTimer);
        this._mintCountdownTimer = null;
      }
      this._renderMintReadiness();
      this._mintCountdownTimer = setInterval(() => this._renderMintReadiness(), 1000);
      return;
    }

    // Mint readiness banner (uses read-only provider; network only when activated)
    this._loadMintReadiness().catch(() => {});
  }

  _onDeactivated() {
    this._isActive = false;
    if (this._mintCountdownTimer) {
      clearInterval(this._mintCountdownTimer);
      this._mintCountdownTimer = null;
    }
    if (this._mintChainRefreshTimer) {
      clearInterval(this._mintChainRefreshTimer);
      this._mintChainRefreshTimer = null;
    }
  }

  async _loadMintReadiness() {
    if (!this.mintStatusEl) return;

    // Ensure we don't create multiple timers
    if (this._mintCountdownTimer) {
      clearInterval(this._mintCountdownTimer);
      this._mintCountdownTimer = null;
    }

    await this._refreshMintReadinessFromChain();
    this._mintLastFetchAt = Date.now();

    // Update every second for countdown UX
    this._renderMintReadiness();
    this._mintCountdownTimer = setInterval(() => this._renderMintReadiness(), 1000);
  }

  async _refreshMintReadinessFromChain() {
    if (!this.mintStatusEl) return;

    const contractManager = window.contractManager;
    const contract = contractManager?.getReadContract?.();
    if (!contract) {
      this._setMintReadinessState({ lastDate: '—', status: 'Contract not ready', statusTone: 'muted' });
      return;
    }

    if (typeof contract.lastMintTime !== 'function') {
      this._setMintReadinessState({ lastDate: '—', status: 'Not supported by contract', statusTone: 'muted' });
      return;
    }

    try {
      // Prefer batched parameters (reduces duplicate calls when other tabs also load mint params).
      let v = null;
      if (typeof contractManager?.getParametersBatch === 'function') {
        try {
          const batch = await contractManager.getParametersBatch();
          v = batch?.lastMintTime ?? null;
        } catch {
          // ignore
        }
      }
      if (v == null) {
        v = await contract.lastMintTime();
      }
      const sec = Number(v?.toString?.() ?? v);
      if (!Number.isFinite(sec) || sec <= 0) {
        this._mintLastMintSec = null;
        this._setMintReadinessState({ lastDate: '—', status: 'Unknown', statusTone: 'muted' });
        return;
      }
      this._mintLastMintSec = sec;
    } catch (e) {
      this._mintLastMintSec = null;
      this._setMintReadinessState({ lastDate: '—', status: 'Failed to load', statusTone: 'error' });
    }
  }

  _renderMintReadiness() {
    if (!this.mintStatusEl || !this._mintLastMintSec) return;

    const lastMintDate = new Date(this._mintLastMintSec * 1000);
    const nowSec = BigInt(Math.ceil(Date.now() / 1000));
    const lastSec = BigInt(Math.ceil(lastMintDate.getTime() / 1000));
    const elapsed = nowSec - lastSec;

    const ready = elapsed > this._mintIntervalSec;
    if (ready) {
      this._setMintReadinessState({
        lastDate: lastMintDate.toLocaleString() + ' YLT',
        status: 'Ready',
        statusTone: 'success',
        showCountdown: false,
        showReadyDate: false,
      });
      return;
    }

    const remaining = this._mintIntervalSec - elapsed;
    const nextReadyMs = Number(lastSec + this._mintIntervalSec) * 1000;
    const nextReadyDate = new Date(nextReadyMs);

    this._setMintReadinessState({
      lastDate: lastMintDate.toLocaleString() + ' YLT',
      status: 'Not Ready',
      statusTone: 'error',
      countdown: formatCountdown(remaining),
      readyDate: nextReadyDate.toLocaleString() + ' YLT',
      showCountdown: true,
      showReadyDate: true,
    });
  }

  _setMintReadinessState({ lastDate, status, statusTone, countdown, readyDate, showCountdown = false, showReadyDate = false }) {
    if (this.mintLastDateEl) {
      this.mintLastDateEl.textContent = lastDate || '—';
    }
    if (this.mintStatusEl) {
      this.mintStatusEl.textContent = status || '—';
      if (statusTone === 'success') this.mintStatusEl.style.color = 'var(--success-color)';
      else if (statusTone === 'error') this.mintStatusEl.style.color = 'var(--danger-color)';
      else this.mintStatusEl.style.color = 'var(--secondary-text-color)';
    }
    if (this.mintCountdownEl) {
      this.mintCountdownEl.textContent = countdown || '—';
    }
    if (this.mintCountdownWrap) {
      this.mintCountdownWrap.style.display = showCountdown ? 'flex' : 'none';
    }
    if (this.mintReadyDateEl) {
      this.mintReadyDateEl.textContent = readyDate || '—';
    }
    if (this.mintReadyDateWrap) {
      this.mintReadyDateWrap.style.display = showReadyDate ? 'flex' : 'none';
    }
  }

  _populateOpTypes() {
    if (!this.typeSelect) return;

    const preLaunchOps = [
      { value: 0, label: 'Mint (3,000,000 LIB → contract)' },
      { value: 1, label: 'Burn (from contract balance)' },
      { value: 8, label: 'Distribute (contract → recipient)' },
    ];

    const postLaunchOps = [
      { value: 2, label: 'PostLaunch' },
      { value: 3, label: 'Pause' },
      { value: 4, label: 'Unpause' },
      { value: 5, label: 'SetBridgeInCaller' },
      { value: 6, label: 'SetBridgeInLimits' },
      { value: 7, label: 'UpdateSigner' },
    ];

    this.typeSelect.innerHTML = [
      `<option value="">Select an operation…</option>`,
      `<optgroup label="Pre-Launch">`,
      ...preLaunchOps.map((o) => `<option value="${o.value}">${o.label}</option>`),
      `</optgroup>`,
      `<optgroup label="Post-Launch">`,
      ...postLaunchOps.map((o) => `<option value="${o.value}">${o.label}</option>`),
      `</optgroup>`,
    ].join('');
  }

  _onOperationTypeChange() {
    const opType = this._readOpType();

    // Clear all input fields when switching operation types
    if (this.targetInput) {
      this.targetInput.value = '';
      this.targetInput.disabled = false;
    }
    if (this.valueInput) {
      this.valueInput.value = '';
      this.valueInput.disabled = false;
    }
    if (this.dataInput) {
      this.dataInput.value = '';
      this.dataInput.disabled = false;
    }

    const targetLabel = this.panel?.querySelector('[data-propose-target-label]');
    const valueLabel = this.panel?.querySelector('[data-propose-value-label]');
    const dataLabel = this.panel?.querySelector('[data-propose-data-label]');

    const contractAddr = CONFIG?.CONTRACT?.ADDRESS || '';

    // Default: show all, generic placeholders.
    this._setFieldVisibility({ target: true, value: true, data: true });
    if (targetLabel) targetLabel.textContent = 'Target';
    if (valueLabel) valueLabel.textContent = 'Value';
    if (dataLabel) dataLabel.textContent = 'Data';
    if (this.targetInput) this.targetInput.placeholder = '0x…';
    if (this.valueInput) this.valueInput.placeholder = '0';
    if (this.dataInput) this.dataInput.placeholder = '0x';

    // Show/hide and set summary
    const summaryText = this.summaryEl?.querySelector('p');
    if (!opType && opType !== 0) {
      // No operation selected
      if (this.summaryEl) this.summaryEl.style.display = 'none';
    } else {
      if (this.summaryEl) this.summaryEl.style.display = 'block';
    }

    // Per-operation UX
    switch (opType) {
      case 0: { // Mint
        if (summaryText) summaryText.textContent = 'Mints 3,000,000 LIB tokens to the contract balance (pre-launch only, subject to mint interval and max supply).';
        this._setFieldVisibility({ target: false, value: false, data: false });
        break;
      }
      case 1: { // Burn
        if (summaryText) summaryText.textContent = 'Burns tokens from the contract balance, reducing total supply (pre-launch only).';
        if (targetLabel) targetLabel.textContent = 'Target (read-only: burn always uses contract balance)';
        if (this.targetInput) this.targetInput.value = contractAddr;
        if (this.targetInput) this.targetInput.disabled = true;
        if (valueLabel) valueLabel.textContent = 'Amount to burn (LIB)';
        if (this.valueInput) this.valueInput.placeholder = 'e.g. 1000';
        this._setFieldVisibility({ target: true, value: true, data: false });
        break;
      }
      case 8: { // DistributeTokens
        if (summaryText) summaryText.textContent = 'Transfers tokens from the contract balance to a recipient address.';
        if (targetLabel) targetLabel.textContent = 'Recipient';
        if (this.targetInput) this.targetInput.disabled = false;
        if (valueLabel) valueLabel.textContent = 'Amount to distribute (LIB)';
        if (this.valueInput) this.valueInput.placeholder = 'e.g. 1000';
        this._setFieldVisibility({ target: true, value: true, data: false });
        break;
      }
      case 2: { // PostLaunch
        if (summaryText) summaryText.textContent = 'Moves the contract from pre-launch to post-launch mode (enables bridge out, disables mint/burn).';
        this._setFieldVisibility({ target: false, value: false, data: false });
        break;
      }
      case 3: { // Pause
        if (summaryText) summaryText.textContent = 'Pauses all token transfers, minting, and burning operations.';
        this._setFieldVisibility({ target: false, value: false, data: false });
        break;
      }
      case 4: { // Unpause
        if (summaryText) summaryText.textContent = 'Resumes all token transfers, minting, and burning operations.';
        this._setFieldVisibility({ target: false, value: false, data: false });
        break;
      }
      case 5: { // SetBridgeInCaller
        if (summaryText) summaryText.textContent = 'Sets the authorized address that can call bridgeIn to mint tokens from cross-chain transfers.';
        if (targetLabel) targetLabel.textContent = 'New bridge-in caller address';
        if (this.targetInput) this.targetInput.disabled = false;
        this._setFieldVisibility({ target: true, value: false, data: false });
        break;
      }
      case 6: { // SetBridgeInLimits
        if (summaryText) summaryText.textContent = 'Updates the maximum amount per bridge-in and the cooldown period between bridge-in operations.';
        if (targetLabel) targetLabel.textContent = 'Target (unused)';
        if (this.targetInput) this.targetInput.value = contractAddr;
        if (this.targetInput) this.targetInput.disabled = true;
        if (valueLabel) valueLabel.textContent = 'New max bridge-in amount (LIB)';
        if (this.valueInput) this.valueInput.placeholder = 'e.g. 10000';
        if (dataLabel) dataLabel.textContent = 'New cooldown (seconds)';
        if (this.dataInput) this.dataInput.placeholder = 'e.g. 60';
        if (this.dataInput) this.dataInput.disabled = false;
        break;
      }
      case 7: { // UpdateSigner
        if (summaryText) summaryText.textContent = 'Replaces an existing signer with a new signer address (requires 3 signatures, including the signer being replaced).';
        if (targetLabel) targetLabel.textContent = 'Old signer address';
        if (valueLabel) valueLabel.textContent = 'New signer address';
        if (this.targetInput) this.targetInput.disabled = false;
        if (this.valueInput) this.valueInput.disabled = false;
        this._setFieldVisibility({ target: true, value: true, data: false });
        break;
      }
      default: {
        if (summaryText) summaryText.textContent = '';
        if (this.summaryEl) this.summaryEl.style.display = 'none';
      }
    }

    // Ensure disabled flags aren't left over from previous op selection.
    this._normalizeDisabledForHiddenFields();
  }

  _resetForm() {
    // Clear operation type selector
    if (this.typeSelect) {
      this.typeSelect.value = '';
    }

    // Clear all input fields
    if (this.targetInput) {
      this.targetInput.value = '';
    }
    if (this.valueInput) {
      this.valueInput.value = '';
    }
    if (this.dataInput) {
      this.dataInput.value = '';
    }

    // Reset form to initial state (field visibility, labels, etc.)
    this._onOperationTypeChange();
  }

  _normalizeDisabledForHiddenFields() {
    // If a field is hidden, disable it. If visible, enable it (network manager will still gate).
    const set = (wrap, input) => {
      const hidden = wrap?.classList?.contains('hidden');
      if (!input) return;
      if (hidden) input.disabled = true;
      // else leave as-is (some ops intentionally set disabled)
    };
    set(this.targetWrap, this.targetInput);
    set(this.valueWrap, this.valueInput);
    set(this.dataWrap, this.dataInput);
  }

  _setFieldVisibility({ target, value, data }) {
    this.targetWrap?.classList.toggle('hidden', !target);
    this.valueWrap?.classList.toggle('hidden', !value);
    this.dataWrap?.classList.toggle('hidden', !data);
  }

  _readOpType() {
    const raw = this.typeSelect?.value;
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  async _onSubmit() {
    if (this._isSubmitting) return;

    const toast = window.toastManager;
    const networkManager = window.networkManager;
    const walletManager = window.walletManager;
    const contractManager = window.contractManager;

    if (!networkManager?.isTxEnabled?.()) {
      toast?.error?.('Connect MetaMask on Polygon to submit proposals.');
      return;
    }

    const write = contractManager?.getWriteContract?.();
    const read = contractManager?.getReadContract?.();
    const from = walletManager?.getAddress?.();
    if (!write || !read || !from) {
      toast?.error?.('Wallet/contract not ready.');
      return;
    }

    const opType = this._readOpType();
    if (opType == null) {
      toast?.error?.('Select an operation type.');
      return;
    }

    let target = CONFIG?.CONTRACT?.ADDRESS || '0x0000000000000000000000000000000000000000';
    let value = 0;
    let data = '0x';

    try {
      ({ target, value, data } = this._buildOperationArgs(opType, from));
    } catch (e) {
      toast?.error?.(e?.message || 'Invalid inputs.');
      return;
    }

    // Best-effort auth check (avoids obvious revert)
    try {
      const isSigner = await read.isSigner(from);
      const owner = await read.owner?.();
      const isOwner = owner && String(owner).toLowerCase() === String(from).toLowerCase();
      if (!isSigner && !isOwner) {
        toast?.error?.('Not authorized: only a signer or the owner can request operations.');
        return;
      }
    } catch {
      // ignore; tx will revert if not authorized
    }

    this._isSubmitting = true;
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = 'Submitting…';
    }

    const submittingId = toast?.loading?.('Submitting proposal…', { id: 'propose-submit', delayMs: 100 });
    let confirmationId = null;
    let confirmationUpdated = false; // Track if confirmation toast was updated to success/error

    try {
      const tx = await write.requestOperation(opType, target, value, data);

      // Dismiss submitting toast and show confirmation toast
      toast?.dismiss?.(submittingId);
      confirmationId = toast?.loading?.('Waiting for confirmation…', { id: 'propose-confirm', title: 'Confirming', delayMs: 0 });
      
      // Update button text to "Confirming…" while waiting for confirmation
      if (this.submitBtn) {
        this.submitBtn.textContent = 'Confirming…';
      }

      const receipt = await tx.wait();
      contractManager?.invalidateParametersCache?.({ notify: true });

      // Try to extract operationId from OperationRequested event in receipt.
      let opId = null;
      try {
        for (const log of receipt?.logs || []) {
          if (String(log.address).toLowerCase() !== String(write.address).toLowerCase()) continue;
          const parsed = write.interface.parseLog(log);
          if (parsed?.name === 'OperationRequested') {
            opId = String(parsed.args?.operationId || parsed.args?.[0] || '');
            break;
          }
        }
      } catch {
        opId = null;
      }

      const msg = opId ? `Operation requested: ${opId}` : 'Operation requested.';
      
      // Dismiss confirmation toast and create a fresh success toast to ensure it's visible
      if (confirmationId) {
        toast?.dismiss?.(confirmationId);
      }
      
      // Format message with clickable transaction hash link on its own line
      const message = formatTxMessage(tx.hash, msg);
      
      // Create success toast (user must dismiss manually)
      toast?.success?.(message, {
        title: 'Proposal submitted',
        id: 'propose-success',
        timeoutMs: 0, // User must dismiss manually
        allowHtml: true,
      });
      confirmationUpdated = true;

      // Reset form to initial state after successful submission
      this._resetForm();

      // Ask proposals list to refresh (best-effort).
      document.dispatchEvent(new CustomEvent('operationRequested', { detail: { txHash: tx.hash, operationId: opId } }));

      // If user requested a Mint proposal, refresh the mint readiness banner (best-effort).
      if (opType === 0) {
        await this._refreshMintReadinessFromChain().catch(() => {});
        this._renderMintReadiness();
      }
    } catch (e) {
      // Dismiss any loading toasts first
      if (submittingId) {
        toast?.dismiss?.(submittingId);
      }
      if (confirmationId) {
        toast?.dismiss?.(confirmationId);
      }
      
      // Extract and normalize error message
      let errorMessage = extractErrorMessage(e, 'Failed to submit proposal');
      errorMessage = normalizeErrorMessage(errorMessage);
      
      // Create a dedicated error toast that will persist
      const errorId = 'propose-error';
      toast?.error?.(errorMessage, {
        title: 'Submit failed',
        id: errorId,
        timeoutMs: 0, // Errors persist until user dismisses
      });
      confirmationUpdated = true;
    } finally {
      // Dismiss confirmation toast if it's still in loading state (button re-enabled)
      // Success/error toasts will remain visible
      if (confirmationId && !confirmationUpdated) {
        toast?.dismiss?.(confirmationId);
      }
      this._isSubmitting = false;
      if (this.submitBtn) {
        this.submitBtn.textContent = 'Request Operation';
        // Network manager will re-gate this based on tx-enabled.
        this.submitBtn.disabled = false;
        window.networkManager?.updateUIState?.();
      }
    }
  }

  _buildOperationArgs(opType, fromAddress) {
    const contractAddr = CONFIG?.CONTRACT?.ADDRESS || '0x0000000000000000000000000000000000000000';

    // Defaults
    let target = contractAddr;
    let value = 0;
    let data = '0x';

    const addr = (s, label = 'address') => {
      try {
        return window.ethers.utils.getAddress(String(s).trim());
      } catch {
        throw new Error(`Invalid ${label}`);
      }
    };

    const amountWei = (s, label = 'amount') => {
      const raw = String(s ?? '').trim();
      if (!raw) throw new Error(`Enter ${label}`);
      try {
        const bn = window.ethers.utils.parseEther(raw);
        if (bn.lte(0)) throw new Error('zero');
        return bn;
      } catch {
        throw new Error(`Invalid ${label}`);
      }
    };

    const op = Number(opType);

    if (op === 0) {
      // Mint: contract mints fixed MINT_AMOUNT. Store MINT_AMOUNT in `value` for transparency.
      target = contractAddr;
      value = window.ethers.utils.parseEther('3000000');
      data = '0x';
      return { target, value, data };
    }

    if (op === 1) {
      // Burn: burns from contract balance, amount = value
      target = contractAddr;
      value = amountWei(this.valueInput?.value, 'burn amount (LIB)');
      data = '0x';
      return { target, value, data };
    }

    if (op === 8) {
      // DistributeTokens: target = recipient, value = amount
      target = addr(this.targetInput?.value, 'recipient address');
      value = amountWei(this.valueInput?.value, 'distribution amount (LIB)');
      data = '0x';
      return { target, value, data };
    }

    if (op === 2 || op === 3 || op === 4) {
      // PostLaunch / Pause / Unpause: args unused
      target = contractAddr;
      value = 0;
      data = '0x';
      return { target, value, data };
    }

    if (op === 5) {
      // SetBridgeInCaller: target = new caller
      target = addr(this.targetInput?.value, 'bridge-in caller address');
      value = 0;
      data = '0x';
      return { target, value, data };
    }

    if (op === 6) {
      // SetBridgeInLimits: value = newMaxAmount, data = abi.encode(uint256 newCooldown)
      target = contractAddr;
      value = amountWei(this.valueInput?.value, 'max bridge-in amount (LIB)');
      const cooldownRaw = String(this.dataInput?.value ?? '').trim();
      const cooldown = Number(cooldownRaw);
      if (!Number.isFinite(cooldown) || cooldown <= 0) throw new Error('Invalid cooldown (seconds)');
      data = window.ethers.utils.defaultAbiCoder.encode(['uint256'], [cooldown]);
      return { target, value, data };
    }

    if (op === 7) {
      // UpdateSigner: target = oldSigner, value encodes newSigner address in uint256
      const oldSigner = addr(this.targetInput?.value, 'old signer address');
      const newSigner = addr(this.valueInput?.value, 'new signer address');
      if (oldSigner.toLowerCase() === newSigner.toLowerCase()) throw new Error('Old and new signer must differ');
      if (oldSigner.toLowerCase() === String(fromAddress || '').toLowerCase()) {
        // Mirrors contract guard: cannot request to replace self.
        throw new Error('Cannot request to replace the connected wallet (self).');
      }
      target = oldSigner;
      value = newSigner; // ethers encodes hex string into uint256
      data = '0x';
      return { target, value, data };
    }

    // Fallback: allow raw inputs (advanced)
    if (this.targetInput?.value) target = addr(this.targetInput.value, 'target address');
    if (this.valueInput?.value) value = window.ethers.BigNumber.from(this.valueInput.value);
    if (this.dataInput?.value) data = String(this.dataInput.value || '0x').trim() || '0x';
    if (!data.startsWith('0x')) throw new Error('Data must be hex (0x…)');
    return { target, value, data };
  }
}

function formatCountdown(secondsBigInt) {
  const seconds = Number(secondsBigInt); // Convert BigInt to Number
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const secs = seconds % 60;

  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
    [
      days > 0 ? `${days} days` : null,
      hours > 0 ? `${hours} hours` : null,
      minutes > 0 ? `${minutes} minutes` : null,
      secs > 0 ? `${secs} seconds` : null,
    ].filter(Boolean)
  );
}

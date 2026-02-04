import { CONFIG } from '../config.js';
import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class LockTab {
  constructor() {
    this.panel = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="lock"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Lock Tokens</h2>
        <p class="muted">Transfer ERC20 tokens into the lock contract with a cliff and daily vesting rate.</p>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field field--full">
            <span class="field-label">Token Address</span>
            <input class="field-input" data-lock-token placeholder="0x..." />
          </label>
          <label class="field">
            <span class="field-label">Token Symbol</span>
            <input class="field-input" data-lock-symbol value="" readonly />
          </label>
          <label class="field">
            <span class="field-label">Token Decimals</span>
            <input class="field-input" data-lock-decimals value="" readonly />
          </label>
          <label class="field">
            <span class="field-label">Amount (tokens)</span>
            <input class="field-input" data-lock-amount type="number" min="0" step="any" placeholder="1000" />
          </label>
          <label class="field">
            <span class="field-label">Cliff (days)</span>
            <input class="field-input" data-lock-cliff type="number" min="0" step="1" value="0" />
          </label>
          <label class="field">
            <span class="field-label">Vesting Duration (days)</span>
            <input class="field-input" data-lock-duration type="number" min="1" step="1" value="365" />
          </label>
          <label class="field">
            <span class="field-label">Daily %</span>
            <input class="field-input" data-lock-rate-pct value="" readonly />
          </label>
          <label class="field field--full">
            <span class="field-label">Withdraw Address (optional)</span>
            <input class="field-input" data-lock-withdraw placeholder="Defaults to your wallet" />
          </label>
        </div>

        <div class="actions" style="gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn--primary" data-lock-submit>Lock</button>
        </div>

        <p class="muted" style="margin-top:12px;">
          Contract: <code>${CONFIG.CONTRACT.ADDRESS}</code>
        </p>
      </div>
    `;

    this._bind();
    this._updateRate();
  }

  _bind() {
    this.tokenInput = this.panel.querySelector('[data-lock-token]');
    this.decimalsInput = this.panel.querySelector('[data-lock-decimals]');
    this.symbolInput = this.panel.querySelector('[data-lock-symbol]');
    this.amountInput = this.panel.querySelector('[data-lock-amount]');
    this.cliffInput = this.panel.querySelector('[data-lock-cliff]');
    this.durationInput = this.panel.querySelector('[data-lock-duration]');
    this.ratePctInput = this.panel.querySelector('[data-lock-rate-pct]');
    this.withdrawInput = this.panel.querySelector('[data-lock-withdraw]');
    this.submitBtn = this.panel.querySelector('[data-lock-submit]');

    this.durationInput?.addEventListener('input', () => this._updateRate());
    this.tokenInput?.addEventListener('input', () => this._scheduleTokenMetaLoad());
    this.tokenInput?.addEventListener('blur', () => this._loadTokenMeta());
    this.submitBtn?.addEventListener('click', () => this._submit());
  }

  _updateRate() {
    const duration = Number(this.durationInput?.value || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      this.rateInput.value = '';
      this.ratePctInput.value = '';
      return;
    }
    const rate = Math.floor(RATE_SCALE / duration);
    const pct = (rate / RATE_SCALE) * 100;
    this.ratePctInput.value = `${pct.toFixed(6)}%`;
  }

  _scheduleTokenMetaLoad() {
    if (this._tokenMetaTimer) {
      clearTimeout(this._tokenMetaTimer);
    }
    const token = (this.tokenInput?.value || '').trim();
    const normalized = this._normalizeAddress(token);
    if (!normalized) {
      this._clearTokenMeta();
      return;
    }
    this._tokenMetaTimer = setTimeout(() => {
      this._tokenMetaTimer = null;
      this._loadTokenMeta();
    }, 350);
  }

  async _loadTokenMeta() {
    const token = (this.tokenInput?.value || '').trim();
    if (!token) return;
    const normalized = this._normalizeAddress(token);
    if (!normalized) {
      this._clearTokenMeta();
      return;
    }
    if (this._lastTokenMeta === normalized) return;
    try {
      const meta = await window.contractManager.getTokenMetadata(normalized);
      if (meta) {
        this._tokenMeta = { ...meta };
        this.decimalsInput.value = meta.decimals == null ? '' : String(meta.decimals);
        this.symbolInput.value = meta.symbol || '';
        this._lastTokenMeta = normalized;
      }
    } catch (err) {
      this._clearTokenMeta();
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load token metadata'));
      window.toastManager?.error(msg, { title: 'Token lookup failed' });
    }
  }

  async _submit() {
    try {
      const token = (this.tokenInput?.value || '').trim();
      const amount = Number(this.amountInput?.value || 0);
      const cliffDays = Number(this.cliffInput?.value || 0);
      const durationDays = Number(this.durationInput?.value || 0);
      const ratePerDay = Number.isFinite(durationDays) && durationDays > 0
        ? Math.floor(RATE_SCALE / durationDays)
        : 0;
      const withdrawAddress = (this.withdrawInput?.value || '').trim();

      if (!token) throw new Error('Token address required');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');
      if (!Number.isFinite(cliffDays) || cliffDays < 0) throw new Error('Invalid cliff');
      if (!ratePerDay || ratePerDay <= 0) throw new Error('Invalid rate');

      await this._ensureTokenMeta(token);
      if (this._tokenMeta.decimals == null) throw new Error('Load token info first');
      const parsedAmount = window.ethers.utils.parseUnits(
        amount.toString(),
        this._tokenMeta.decimals
      );

      const owner = window.walletManager?.getAddress?.();
      if (!owner) throw new Error('Wallet not connected');

      let flowToastId = null;
      let lockToastId = null;

      try {
        flowToastId = window.toastManager?.loading('Checking approval...', { delayMs: 0 });
        const allowance = await window.contractManager.getTokenAllowance(
          token,
          owner,
          CONFIG.CONTRACT.ADDRESS
        );
        const needsApproval = !allowance || allowance.lt(parsedAmount);

        if (needsApproval) {
          window.toastManager?.update(flowToastId, {
            type: 'loading',
            title: 'Approval',
            message: 'Submitting approval...',
          });
          const approveTx = await window.contractManager.approveToken({
            token,
            spender: CONFIG.CONTRACT.ADDRESS,
            amount: parsedAmount,
          });
          const approveReceipt = await approveTx.wait();
          window.toastManager?.update(flowToastId, {
            type: 'success',
            title: 'Approved',
            message: formatTxMessage(approveReceipt.transactionHash, 'Approval confirmed.'),
            allowHtml: true,
            timeoutMs: 5000,
          });
          await this._sleep(1200);
        } else {
          window.toastManager?.dismiss?.(flowToastId);
          flowToastId = null;
        }

        lockToastId = window.toastManager?.loading('Submitting lock...', { delayMs: 0 });
        const tx = await window.contractManager.lock({
          token,
          amount: parsedAmount,
          cliffDays: Math.floor(cliffDays),
          ratePerDay: ratePerDay,
          withdrawAddress: withdrawAddress || ZERO_ADDRESS,
        });
        const receipt = await tx.wait();
        window.toastManager?.update(lockToastId, {
          type: 'success',
          title: 'Lock created',
          message: formatTxMessage(receipt.transactionHash, 'Lock confirmed.'),
          allowHtml: true,
          timeoutMs: 5000,
        });

        // Refresh overview tab data
        window.overviewTab?.refreshLocks?.();
      } catch (innerErr) {
        if (flowToastId) window.toastManager?.dismiss?.(flowToastId);
        if (lockToastId) window.toastManager?.dismiss?.(lockToastId);
        throw innerErr;
      }
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Lock failed'));
      window.toastManager?.error(msg, { title: 'Lock failed', timeoutMs: 0 });
    }
  }

  async _ensureTokenMeta(token) {
    if (!this._tokenMeta || this._tokenMeta._token !== token) {
      const normalized = this._normalizeAddress(token);
      const meta = await window.contractManager.getTokenMetadata(normalized || token);
      this._tokenMeta = { ...(meta || { symbol: '', decimals: null }), _token: normalized || token };
      this.decimalsInput.value = this._tokenMeta.decimals == null ? '' : String(this._tokenMeta.decimals);
      this.symbolInput.value = this._tokenMeta.symbol || '';
      this._lastTokenMeta = normalized || token;
    }
  }

  _normalizeAddress(value) {
    if (!value) return '';
    try {
      return window.ethers.utils.getAddress(value);
    } catch {
      return '';
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _clearTokenMeta() {
    this._tokenMeta = { symbol: '', decimals: null };
    this._lastTokenMeta = '';
    if (this.decimalsInput) this.decimalsInput.value = '';
    if (this.symbolInput) this.symbolInput.value = '';
  }
}

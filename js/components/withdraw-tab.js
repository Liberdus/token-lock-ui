import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class WithdrawTab {
  constructor() {
    this.panel = null;
    this._lock = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="withdraw"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Withdraw</h2>
        <p class="muted">Withdraw unlocked tokens for a lock ID.</p>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Lock ID</span>
            <input class="field-input" data-withdraw-id type="number" min="0" step="1" placeholder="0" />
          </label>
          <label class="field">
            <span class="field-label">Token</span>
            <input class="field-input" data-withdraw-token readonly />
          </label>
          <label class="field">
            <span class="field-label">Amount (tokens)</span>
            <input class="field-input" data-withdraw-amount type="number" min="0" step="any" placeholder="0" />
          </label>
          <label class="field">
            <span class="field-label">Percent (0-100)</span>
            <input class="field-input" data-withdraw-percent type="number" min="0" max="100" step="0.01" placeholder="100" />
          </label>
          <label class="field field--full">
            <span class="field-label">Withdraw To (optional)</span>
            <input class="field-input" data-withdraw-to placeholder="Defaults to withdraw address" />
          </label>
          <label class="field field--full">
            <span class="field-label">Available Now</span>
            <input class="field-input" data-withdraw-available readonly />
          </label>
        </div>

        <div class="actions" style="gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn" data-withdraw-load>Load Lock</button>
          <button type="button" class="btn" data-withdraw-refresh>Refresh Available</button>
          <button type="button" class="btn" data-withdraw-max>Use 100%</button>
          <button type="button" class="btn btn--primary" data-withdraw-submit>Withdraw</button>
        </div>
      </div>
    `;

    this._bind();
  }

  _bind() {
    this.lockIdInput = this.panel.querySelector('[data-withdraw-id]');
    this.tokenInput = this.panel.querySelector('[data-withdraw-token]');
    this.amountInput = this.panel.querySelector('[data-withdraw-amount]');
    this.percentInput = this.panel.querySelector('[data-withdraw-percent]');
    this.toInput = this.panel.querySelector('[data-withdraw-to]');
    this.availableInput = this.panel.querySelector('[data-withdraw-available]');
    this.loadBtn = this.panel.querySelector('[data-withdraw-load]');
    this.refreshBtn = this.panel.querySelector('[data-withdraw-refresh]');
    this.maxBtn = this.panel.querySelector('[data-withdraw-max]');
    this.submitBtn = this.panel.querySelector('[data-withdraw-submit]');

    this.loadBtn?.addEventListener('click', () => this._loadLock());
    this.refreshBtn?.addEventListener('click', () => this._refreshAvailable());
    this.maxBtn?.addEventListener('click', () => {
      this.percentInput.value = '100';
      this.amountInput.value = '';
    });
    this.submitBtn?.addEventListener('click', () => this._submit());
  }

  async _loadLock() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      this._lock = lock;
      this.tokenInput.value = lock.token;
      await this._ensureTokenMeta(lock.token);
      await this._refreshAvailable();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load lock'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _refreshAvailable() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadLock();
      }
      const available = await window.contractManager.previewWithdrawable(lockId);
      if (available == null) return;
      const formatted = window.ethers.utils.formatUnits(available, this._tokenMeta.decimals || 18);
      this.availableInput.value = formatted;
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to fetch available amount'));
      window.toastManager?.error(msg, { title: 'Refresh failed' });
    }
  }

  async _submit() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadLock();
      }

      const amountStr = (this.amountInput?.value || '').trim();
      const percentStr = (this.percentInput?.value || '').trim();
      const to = (this.toInput?.value || '').trim();

      const hasAmount = amountStr !== '' && Number(amountStr) > 0;
      const hasPercent = percentStr !== '' && Number(percentStr) > 0;
      if (hasAmount && hasPercent) throw new Error('Use amount or percent, not both');
      if (!hasAmount && !hasPercent) throw new Error('Enter amount or percent');

      let amount = window.ethers.BigNumber.from(0);
      let percent = 0;

      if (hasAmount) {
        await this._ensureTokenMeta(this._lock.token);
        amount = window.ethers.utils.parseUnits(amountStr, this._tokenMeta.decimals || 18);
        percent = 0;
      } else {
        const pct = Number(percentStr);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Percent must be 0-100');
        percent = Math.floor((RATE_SCALE * pct) / 100);
        amount = window.ethers.BigNumber.from(0);
      }

      const loadingId = window.toastManager?.loading('Submitting withdrawal...');
      const tx = await window.contractManager.withdraw({
        lockId,
        amount,
        percent,
        to: to || ZERO_ADDRESS,
      });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Withdrawn',
        message: formatTxMessage(receipt.transactionHash, 'Withdrawal confirmed.'),
        allowHtml: true,
        timeoutMs: 6000,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Withdraw failed'));
      window.toastManager?.error(msg, { title: 'Withdraw failed' });
    }
  }

  async _ensureTokenMeta(token) {
    if (!this._tokenMeta || this._tokenMeta._token !== token) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta = { ...(meta || { symbol: '', decimals: 18 }), _token: token };
    }
  }
}

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
          <label class="field">
            <span class="field-label">Token Address</span>
            <input class="field-input" data-lock-token placeholder="0x..." />
          </label>
          <label class="field">
            <span class="field-label">Token Decimals</span>
            <input class="field-input" data-lock-decimals value="18" readonly />
          </label>
          <label class="field">
            <span class="field-label">Token Symbol</span>
            <input class="field-input" data-lock-symbol value="" readonly />
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
            <span class="field-label">Rate Per Day (scaled)</span>
            <input class="field-input" data-lock-rate value="" readonly />
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
          <button type="button" class="btn" data-lock-fetch>Load Token Info</button>
          <button type="button" class="btn" data-lock-approve>Approve</button>
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
    this.rateInput = this.panel.querySelector('[data-lock-rate]');
    this.ratePctInput = this.panel.querySelector('[data-lock-rate-pct]');
    this.withdrawInput = this.panel.querySelector('[data-lock-withdraw]');
    this.fetchBtn = this.panel.querySelector('[data-lock-fetch]');
    this.approveBtn = this.panel.querySelector('[data-lock-approve]');
    this.submitBtn = this.panel.querySelector('[data-lock-submit]');

    this.durationInput?.addEventListener('input', () => this._updateRate());
    this.fetchBtn?.addEventListener('click', () => this._loadTokenMeta());
    this.approveBtn?.addEventListener('click', () => this._approve());
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
    this.rateInput.value = String(rate);
    this.ratePctInput.value = `${pct.toFixed(6)}%`;
  }

  async _loadTokenMeta() {
    const token = (this.tokenInput?.value || '').trim();
    if (!token) return;
    try {
      const meta = await window.contractManager.getTokenMetadata(token);
      if (meta) {
        this._tokenMeta = meta;
        this.decimalsInput.value = String(meta.decimals ?? 18);
        this.symbolInput.value = meta.symbol || '';
      }
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load token metadata'));
      window.toastManager?.error(msg, { title: 'Token lookup failed' });
    }
  }

  async _approve() {
    try {
      const token = (this.tokenInput?.value || '').trim();
      const amount = Number(this.amountInput?.value || 0);
      if (!token) throw new Error('Token address required');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');
      await this._ensureTokenMeta(token);

      const parsed = window.ethers.utils.parseUnits(
        amount.toString(),
        this._tokenMeta.decimals || 18
      );

      const loadingId = window.toastManager?.loading('Submitting approval...');
      const tx = await window.contractManager.approveToken({
        token,
        spender: CONFIG.CONTRACT.ADDRESS,
        amount: parsed,
      });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Approved',
        message: formatTxMessage(receipt.transactionHash, 'Approval confirmed.'),
        allowHtml: true,
        timeoutMs: 6000,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Approval failed'));
      window.toastManager?.error(msg, { title: 'Approval failed' });
    }
  }

  async _submit() {
    try {
      const token = (this.tokenInput?.value || '').trim();
      const amount = Number(this.amountInput?.value || 0);
      const cliffDays = Number(this.cliffInput?.value || 0);
      const ratePerDay = this.rateInput?.value ? Number(this.rateInput.value) : 0;
      const withdrawAddress = (this.withdrawInput?.value || '').trim();

      if (!token) throw new Error('Token address required');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');
      if (!Number.isFinite(cliffDays) || cliffDays < 0) throw new Error('Invalid cliff');
      if (!ratePerDay || ratePerDay <= 0) throw new Error('Invalid rate');

      await this._ensureTokenMeta(token);
      const parsedAmount = window.ethers.utils.parseUnits(
        amount.toString(),
        this._tokenMeta.decimals || 18
      );

      const loadingId = window.toastManager?.loading('Submitting lock...');
      const tx = await window.contractManager.lock({
        token,
        amount: parsedAmount,
        cliffDays: Math.floor(cliffDays),
        ratePerDay: ratePerDay,
        withdrawAddress: withdrawAddress || ZERO_ADDRESS,
      });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Lock created',
        message: formatTxMessage(receipt.transactionHash, 'Lock confirmed.'),
        allowHtml: true,
        timeoutMs: 6000,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Lock failed'));
      window.toastManager?.error(msg, { title: 'Lock failed' });
    }
  }

  async _ensureTokenMeta(token) {
    if (!this._tokenMeta || this._tokenMeta._token !== token) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta = { ...(meta || { symbol: '', decimals: 18 }), _token: token };
      this.decimalsInput.value = String(this._tokenMeta.decimals ?? 18);
      this.symbolInput.value = this._tokenMeta.symbol || '';
    }
  }
}

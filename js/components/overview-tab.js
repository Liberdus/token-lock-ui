import { extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';

export class OverviewTab {
  constructor() {
    this.panel = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="overview"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Overview</h2>
        <p class="muted">Inspect lock details and preview unlocked amounts.</p>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Lock ID</span>
            <input class="field-input" data-overview-id type="number" min="0" step="1" placeholder="0" />
          </label>
          <div class="field">
            <span class="field-label">Next Lock ID</span>
            <input class="field-input" data-overview-next readonly />
          </div>
        </div>

        <div class="actions" style="gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn" data-overview-next-btn>Refresh Counter</button>
          <button type="button" class="btn btn--primary" data-overview-load>Load Lock</button>
        </div>

        <div style="margin-top:16px;" data-overview-details></div>
      </div>
    `;

    this._bind();
    this._loadNext();
  }

  _bind() {
    this.lockIdInput = this.panel.querySelector('[data-overview-id]');
    this.nextInput = this.panel.querySelector('[data-overview-next]');
    this.nextBtn = this.panel.querySelector('[data-overview-next-btn]');
    this.loadBtn = this.panel.querySelector('[data-overview-load]');
    this.detailsEl = this.panel.querySelector('[data-overview-details]');

    this.nextBtn?.addEventListener('click', () => this._loadNext());
    this.loadBtn?.addEventListener('click', () => this._loadLock());
  }

  async _loadNext() {
    try {
      const next = await window.contractManager.getNextLockId();
      if (next == null) return;
      this.nextInput.value = String(next);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load next lock ID'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _loadLock() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      const preview = await window.contractManager.previewWithdrawable(lockId);
      const meta = await this._ensureTokenMeta(lock.token);
      const fmt = (v) => window.ethers.utils.formatUnits(v || 0, meta.decimals || 18);

      const cliffDays = lock.cliffDays?.toString?.() ?? String(lock.cliffDays);
      const ratePerDay = lock.ratePerDay?.toString?.() ?? String(lock.ratePerDay);
      const unlockTime = lock.unlockTime?.toString?.() ?? String(lock.unlockTime);
      const unlocked = String(!!lock.unlocked);

      this.detailsEl.innerHTML = `
        <div class="form-grid">
          <div class="field"><span class="field-label">Creator</span><div class="field-input">${lock.creator}</div></div>
          <div class="field"><span class="field-label">Token</span><div class="field-input">${lock.token}</div></div>
          <div class="field"><span class="field-label">Withdraw Address</span><div class="field-input">${lock.withdrawAddress}</div></div>
          <div class="field"><span class="field-label">Amount</span><div class="field-input">${fmt(lock.amount)} ${meta.symbol}</div></div>
          <div class="field"><span class="field-label">Withdrawn</span><div class="field-input">${fmt(lock.withdrawn)} ${meta.symbol}</div></div>
          <div class="field"><span class="field-label">Cliff Days</span><div class="field-input">${cliffDays}</div></div>
          <div class="field"><span class="field-label">Rate Per Day</span><div class="field-input">${ratePerDay}</div></div>
          <div class="field"><span class="field-label">Unlock Time</span><div class="field-input">${unlockTime}</div></div>
          <div class="field"><span class="field-label">Unlocked</span><div class="field-input">${unlocked}</div></div>
          <div class="field"><span class="field-label">Available Now</span><div class="field-input">${fmt(preview)} ${meta.symbol}</div></div>
        </div>
      `;
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load lock'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _ensureTokenMeta(token) {
    if (!this._tokenMeta || this._tokenMeta._token !== token) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta = { ...(meta || { symbol: '', decimals: 18 }), _token: token };
    }
    return this._tokenMeta;
  }
}

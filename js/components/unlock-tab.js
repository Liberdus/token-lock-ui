import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

export class UnlockTab {
  constructor() {
    this.panel = null;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="unlock"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Unlock</h2>
        <p class="muted">Start the cliff countdown by setting the unlock time.</p>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Lock ID</span>
            <input class="field-input" data-unlock-id type="number" min="0" step="1" placeholder="0" />
          </label>
          <label class="field">
            <span class="field-label">Unlock Time (Unix seconds)</span>
            <input class="field-input" data-unlock-time type="number" min="0" step="1" placeholder="e.g. 1770145427" />
          </label>
        </div>
        <div class="actions" style="gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn" data-unlock-now>Set to now + 60s</button>
          <button type="button" class="btn btn--primary" data-unlock-submit>Unlock</button>
        </div>
      </div>
    `;

    this._bind();
  }

  _bind() {
    this.lockIdInput = this.panel.querySelector('[data-unlock-id]');
    this.unlockTimeInput = this.panel.querySelector('[data-unlock-time]');
    this.nowBtn = this.panel.querySelector('[data-unlock-now]');
    this.submitBtn = this.panel.querySelector('[data-unlock-submit]');

    this.nowBtn?.addEventListener('click', () => this._setNowPlus());
    this.submitBtn?.addEventListener('click', () => this._submit());
  }

  async _setNowPlus() {
    try {
      const provider = window.contractManager.getReadContract()?.provider || window.contractManager.getProvider?.();
      const block = await provider.getBlock('latest');
      const unlockTime = Number(block.timestamp) + 60;
      this.unlockTimeInput.value = String(unlockTime);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to fetch chain time'));
      window.toastManager?.error(msg, { title: 'Time lookup failed' });
    }
  }

  async _submit() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      const unlockTime = Number(this.unlockTimeInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!Number.isFinite(unlockTime) || unlockTime <= 0) throw new Error('Invalid unlock time');

      const loadingId = window.toastManager?.loading('Submitting unlock...');
      const tx = await window.contractManager.unlock({ lockId, unlockTime });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Unlocked',
        message: formatTxMessage(receipt.transactionHash, 'Unlock confirmed.'),
        allowHtml: true,
        timeoutMs: 6000,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Unlock failed'));
      window.toastManager?.error(msg, { title: 'Unlock failed' });
    }
  }
}

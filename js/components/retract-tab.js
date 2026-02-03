import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class RetractTab {
  constructor() {
    this.panel = null;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="retract"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Retract</h2>
        <p class="muted">Return locked funds if no withdrawals have occurred.</p>
      </div>

      <div class="card">
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Lock ID</span>
            <input class="field-input" data-retract-id type="number" min="0" step="1" placeholder="0" />
          </label>
          <label class="field field--full">
            <span class="field-label">Withdraw To (optional)</span>
            <input class="field-input" data-retract-to placeholder="Defaults to lock creator" />
          </label>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--primary" data-retract-submit>Retract</button>
        </div>
      </div>
    `;

    this._bind();
  }

  _bind() {
    this.lockIdInput = this.panel.querySelector('[data-retract-id]');
    this.toInput = this.panel.querySelector('[data-retract-to]');
    this.submitBtn = this.panel.querySelector('[data-retract-submit]');

    this.submitBtn?.addEventListener('click', () => this._submit());
  }

  async _submit() {
    try {
      const lockId = Number(this.lockIdInput?.value || 0);
      const to = (this.toInput?.value || '').trim();
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const loadingId = window.toastManager?.loading('Submitting retract...');
      const tx = await window.contractManager.retract({ lockId, to: to || ZERO_ADDRESS });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Retracted',
        message: formatTxMessage(receipt.transactionHash, 'Retract confirmed.'),
        allowHtml: true,
        timeoutMs: 6000,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Retract failed'));
      window.toastManager?.error(msg, { title: 'Retract failed' });
    }
  }
}

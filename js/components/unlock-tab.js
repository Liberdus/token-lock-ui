import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UNLOCK_TIME_BUFFER_SECONDS = 60;

export class LockActionToasts {
  constructor() {
    this._lock = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
  }

  load() {
    // No-op: actions are triggered via toasts on the Overview list.
  }

  openUnlockToast({ lockId } = {}) {
    const message = this._renderUnlockFormHtml();
    const id = window.toastManager?.show?.({
      id: 'unlock-form-toast',
      title: 'Unlock Tokens',
      message,
      type: 'info',
      dismissible: true,
      timeoutMs: 0,
      allowHtml: true,
      className: 'notification--form',
    });

    const toastEl = document.querySelector(`[data-toast-id="${id}"]`);
    const root = toastEl?.querySelector?.('.notification-message');
    if (!root) return;

    this._unlockFormToastId = id;
    this.unlockTimeInput = root.querySelector('[data-unlock-time]');
    this.submitBtn = root.querySelector('[data-unlock-submit]');
    this._activeLockId = Number.isFinite(lockId) ? Number(lockId) : lockId;
    const earliestUnlockTime = Math.floor(Date.now() / 1000) + UNLOCK_TIME_BUFFER_SECONDS;
    this._setUnlockInputMin(earliestUnlockTime);
    this._setUnlockInputValue(this._getLocalDateTimeString(new Date(earliestUnlockTime * 1000)));

    this.unlockTimeInput?.addEventListener('input', () => this._enforceUnlockTimeMin());
    this.submitBtn?.addEventListener('click', () => this._submitUnlock());
  }

  openWithdrawToast({ lockId, lock } = {}) {
    const message = this._renderWithdrawFormHtml();
    const id = window.toastManager?.show?.({
      id: 'withdraw-form-toast',
      title: 'Withdraw Tokens',
      message,
      type: 'info',
      dismissible: true,
      timeoutMs: 0,
      allowHtml: true,
      className: 'notification--form',
    });

    const toastEl = document.querySelector(`[data-toast-id="${id}"]`);
    const root = toastEl?.querySelector?.('.notification-message');
    if (!root) return;

    this.withdrawIdInput = root.querySelector('[data-withdraw-id]');
    this.withdrawTokenInput = root.querySelector('[data-withdraw-token]');
    this.withdrawAmountInput = root.querySelector('[data-withdraw-amount]');
    this.withdrawPercentInput = root.querySelector('[data-withdraw-percent]');
    this.withdrawToInput = root.querySelector('[data-withdraw-to]');
    this.withdrawAvailableInput = root.querySelector('[data-withdraw-available]');
    this.withdrawLoadBtn = root.querySelector('[data-withdraw-load]');
    this.withdrawRefreshBtn = root.querySelector('[data-withdraw-refresh]');
    this.withdrawMaxBtn = root.querySelector('[data-withdraw-max]');
    this.withdrawSubmitBtn = root.querySelector('[data-withdraw-submit]');

    if (lockId != null) {
      this.withdrawIdInput.value = String(lockId);
    }

    if (lock) {
      this._lock = lock;
      this.withdrawTokenInput.value = lock.token || '';
      this._ensureTokenMeta(lock.token).catch(() => {});
      this._refreshWithdrawAvailable().catch(() => {});
    }

    this.withdrawLoadBtn?.addEventListener('click', () => this._loadWithdrawLock());
    this.withdrawRefreshBtn?.addEventListener('click', () => this._refreshWithdrawAvailable());
    this.withdrawMaxBtn?.addEventListener('click', () => {
      this.withdrawPercentInput.value = '100';
      this.withdrawAmountInput.value = '';
    });
    this.withdrawSubmitBtn?.addEventListener('click', () => this._submitWithdraw());
  }

  openRetractToast({ lockId } = {}) {
    const message = this._renderRetractFormHtml();
    const id = window.toastManager?.show?.({
      id: 'retract-form-toast',
      title: 'Retract Lock',
      message,
      type: 'info',
      dismissible: true,
      timeoutMs: 0,
      allowHtml: true,
      className: 'notification--form',
    });

    const toastEl = document.querySelector(`[data-toast-id="${id}"]`);
    const root = toastEl?.querySelector?.('.notification-message');
    if (!root) return;

    this._retractFormToastId = id;
    this.retractIdInput = root.querySelector('[data-retract-id]');
    this.retractToInput = root.querySelector('[data-retract-to]');
    this.retractSubmitBtn = root.querySelector('[data-retract-submit]');

    if (lockId != null) {
      this.retractIdInput.value = String(lockId);
    }

    this.retractSubmitBtn?.addEventListener('click', () => this._submitRetract());
  }

  _renderUnlockFormHtml() {
    return `
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Unlock Time</span>
          <input class="field-input" data-unlock-time type="datetime-local" step="60" />
        </label>
      </div>
      <div class="actions" style="gap: 10px; flex-wrap: wrap;">
        <button type="button" class="btn btn--primary" data-unlock-submit>Unlock</button>
      </div>
    `;
  }

  _renderWithdrawFormHtml() {
    return `
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
    `;
  }

  _renderRetractFormHtml() {
    return `
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Lock ID</span>
          <input class="field-input" data-retract-id type="number" min="0" step="1" placeholder="0" />
        </label>
        <label class="field">
          <span class="field-label">Retract To (optional)</span>
          <input class="field-input" data-retract-to placeholder="Defaults to creator" />
        </label>
      </div>
      <div class="actions" style="gap: 10px; flex-wrap: wrap;">
        <button type="button" class="btn btn--primary" data-retract-submit>Retract</button>
      </div>
    `;
  }

  async _submitUnlock() {
    try {
      const lockId = Number(this._activeLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const chainNow = await this._getChainTimestamp();
      const minUnlockTime = chainNow + UNLOCK_TIME_BUFFER_SECONDS;
      let unlockTime = this._parseUnlockInputToSeconds();
      if (!Number.isFinite(unlockTime) || unlockTime <= 0) throw new Error('Invalid unlock time');
      if (unlockTime < minUnlockTime) {
        unlockTime = minUnlockTime;
        this._setUnlockInputMin(unlockTime);
        this._setUnlockInputValue(this._getLocalDateTimeString(new Date(unlockTime * 1000)));
      }

      const loadingId = window.toastManager?.loading('Submitting unlock...', { delayMs: 0 });
      const tx = await window.contractManager.unlock({ lockId, unlockTime });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Unlocked',
        message: formatTxMessage(receipt.transactionHash, 'Unlock confirmed.'),
        allowHtml: true,
        timeoutMs: 5000,
      });
      if (this._unlockFormToastId) {
        window.toastManager?.dismiss?.(this._unlockFormToastId);
        this._unlockFormToastId = null;
      }
      window.overviewTab?.refreshLocks?.();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Unlock failed'));
      window.toastManager?.error(msg, { title: 'Unlock failed' });
    }
  }

  _setUnlockInputMin(minSeconds = Math.floor(Date.now() / 1000) + UNLOCK_TIME_BUFFER_SECONDS) {
    if (!this.unlockTimeInput) return;
    this.unlockTimeInput.min = this._getLocalDateTimeString(new Date(minSeconds * 1000));
  }

  _enforceUnlockTimeMin() {
    if (!this.unlockTimeInput || !this.unlockTimeInput.value) return;
    const selected = this._parseUnlockInputToSeconds();
    if (!Number.isFinite(selected)) return;
    const minSeconds = Math.floor(Date.now() / 1000) + UNLOCK_TIME_BUFFER_SECONDS;
    this._setUnlockInputMin(minSeconds);
    if (selected < minSeconds) {
      this._setUnlockInputValue(this._getLocalDateTimeString(new Date(minSeconds * 1000)));
    }
  }

  _parseUnlockInputToSeconds() {
    if (!this.unlockTimeInput?.value) return 0;
    const parsed = new Date(this.unlockTimeInput.value);
    const ms = parsed?.getTime?.();
    if (!Number.isFinite(ms)) return 0;
    return Math.floor(ms / 1000);
  }

  _setUnlockInputValue(value) {
    if (this.unlockTimeInput) {
      this.unlockTimeInput.value = value;
    }
  }

  _getLocalDateTimeString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  async _getChainTimestamp() {
    const provider = window.contractManager.getReadContract()?.provider || window.contractManager.getProvider?.();
    const block = await provider.getBlock('latest');
    return Number(block.timestamp);
  }

  async _loadWithdrawLock() {
    try {
      const lockId = Number(this.withdrawIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      this._lock = lock;
      this.withdrawTokenInput.value = lock.token;
      await this._ensureTokenMeta(lock.token);
      await this._refreshWithdrawAvailable();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load lock'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _refreshWithdrawAvailable() {
    try {
      const lockId = Number(this.withdrawIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadWithdrawLock();
      }
      const available = await window.contractManager.previewWithdrawable(lockId);
      if (available == null) return;
      const formatted = window.ethers.utils.formatUnits(available, this._tokenMeta.decimals || 18);
      this.withdrawAvailableInput.value = formatted;
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to fetch available amount'));
      window.toastManager?.error(msg, { title: 'Refresh failed' });
    }
  }

  async _submitWithdraw() {
    try {
      const lockId = Number(this.withdrawIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadWithdrawLock();
      }

      const amountStr = (this.withdrawAmountInput?.value || '').trim();
      const percentStr = (this.withdrawPercentInput?.value || '').trim();
      const to = (this.withdrawToInput?.value || '').trim();

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

      const loadingId = window.toastManager?.loading('Submitting withdrawal...', { delayMs: 0 });
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
        timeoutMs: 0,
      });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Withdraw failed'));
      window.toastManager?.error(msg, { title: 'Withdraw failed' });
    }
  }

  async _submitRetract() {
    try {
      const lockId = Number(this.retractIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      const to = (this.retractToInput?.value || '').trim();

      const loadingId = window.toastManager?.loading('Submitting retract...', { delayMs: 0 });
      const tx = await window.contractManager.retract({
        lockId,
        to: to || ZERO_ADDRESS,
      });
      const receipt = await tx.wait();
      window.toastManager?.update(loadingId, {
        type: 'success',
        title: 'Retracted',
        message: formatTxMessage(receipt.transactionHash, 'Retract confirmed.'),
        allowHtml: true,
        timeoutMs: 5000,
      });
      if (this._retractFormToastId) {
        window.toastManager?.dismiss?.(this._retractFormToastId);
        this._retractFormToastId = null;
      }
      window.overviewTab?.refreshLocks?.();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Retract failed'));
      window.toastManager?.error(msg, { title: 'Retract failed' });
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

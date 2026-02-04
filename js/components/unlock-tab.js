import { CONFIG } from '../config.js';
import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UNLOCK_TIME_BUFFER_SECONDS = 60;

export class LockActionToasts {
  constructor() {
    this._lock = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
    this._lockFormTokenMeta = { symbol: '', decimals: null, _token: '' };
    this._lockFormTokenMetaTimer = null;
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
    const numericLockId = Number(lockId);
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

    this._withdrawFormToastId = id;
    this._activeWithdrawLockId = Number.isFinite(numericLockId) ? numericLockId : null;
    this._lock = null;
    this._tokenMeta = { symbol: '', decimals: 18 };

    this.withdrawLockDisplay = root.querySelector('[data-withdraw-lock]');
    this.withdrawTokenDisplay = root.querySelector('[data-withdraw-token]');
    this.withdrawAvailableDisplay = root.querySelector('[data-withdraw-available]');
    this.withdrawAmountInput = root.querySelector('[data-withdraw-amount]');
    this.withdrawPercentInput = root.querySelector('[data-withdraw-percent]');
    this.withdrawToInput = root.querySelector('[data-withdraw-to]');
    this.withdrawMaxBtn = root.querySelector('[data-withdraw-max]');
    this.withdrawSubmitBtn = root.querySelector('[data-withdraw-submit]');

    if (this.withdrawLockDisplay) {
      this.withdrawLockDisplay.textContent = this._activeWithdrawLockId != null ? `#${this._activeWithdrawLockId}` : '—';
    }
    if (this.withdrawTokenDisplay) {
      this.withdrawTokenDisplay.textContent = 'Loading...';
    }
    if (this.withdrawAvailableDisplay) {
      this.withdrawAvailableDisplay.textContent = 'Loading...';
    }

    if (lock) {
      this._lock = lock;
      this._setWithdrawTokenDisplay(lock.token);
      this._ensureTokenMeta(lock.token)
        .then(() => {
          this._setWithdrawTokenDisplay(lock.token);
          return this._refreshWithdrawAvailable();
        })
        .catch(() => {});
    } else if (this._activeWithdrawLockId != null) {
      this._loadWithdrawLock().catch(() => {});
    }

    this.withdrawAmountInput?.addEventListener('input', () => {
      if ((this.withdrawAmountInput.value || '').trim()) {
        if (this.withdrawPercentInput) this.withdrawPercentInput.value = '';
      }
    });
    this.withdrawPercentInput?.addEventListener('input', () => {
      if ((this.withdrawPercentInput.value || '').trim()) {
        if (this.withdrawAmountInput) this.withdrawAmountInput.value = '';
      }
    });
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
    this._activeRetractLockId = Number.isFinite(Number(lockId)) ? Number(lockId) : null;
    this.retractIdDisplay = root.querySelector('[data-retract-id]');
    this.retractToInput = root.querySelector('[data-retract-to]');
    this.retractSubmitBtn = root.querySelector('[data-retract-submit]');

    if (this.retractIdDisplay) {
      this.retractIdDisplay.textContent = this._activeRetractLockId != null ? `#${this._activeRetractLockId}` : '—';
    }

    this.retractSubmitBtn?.addEventListener('click', () => this._submitRetract());
  }

  openLockToast() {
    const message = this._renderLockFormHtml();
    const id = window.toastManager?.show?.({
      id: 'lock-form-toast',
      title: 'Lock Tokens',
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

    this._lockFormToastId = id;
    this.lockTokenInput = root.querySelector('[data-lock-token]');
    this.lockDecimalsInput = root.querySelector('[data-lock-decimals]');
    this.lockSymbolInput = root.querySelector('[data-lock-symbol]');
    this.lockAmountInput = root.querySelector('[data-lock-amount]');
    this.lockCliffInput = root.querySelector('[data-lock-cliff]');
    this.lockDurationInput = root.querySelector('[data-lock-duration]');
    this.lockRatePctInput = root.querySelector('[data-lock-rate-pct]');
    this.lockWithdrawInput = root.querySelector('[data-lock-withdraw]');
    this.lockSubmitBtn = root.querySelector('[data-lock-submit]');

    if (this._lockFormTokenMetaTimer) {
      clearTimeout(this._lockFormTokenMetaTimer);
      this._lockFormTokenMetaTimer = null;
    }
    this._clearLockTokenMeta();
    this._updateLockRate();

    this.lockDurationInput?.addEventListener('input', () => this._updateLockRate());
    this.lockTokenInput?.addEventListener('input', () => this._scheduleLockTokenMetaLoad());
    this.lockTokenInput?.addEventListener('blur', () => this._loadLockTokenMeta());
    this.lockSubmitBtn?.addEventListener('click', () => this._submitLock());
  }

  _renderUnlockFormHtml() {
    return `
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Unlock Time</span>
          <input class="field-input" data-unlock-time type="datetime-local" step="60" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" data-unlock-submit>Unlock</button>
      </div>
    `;
  }

  _renderWithdrawFormHtml() {
    return `
      <div class="form-grid">
        <div class="field field--inline-readonly">
          <span class="field-label">Lock ID</span>
          <div class="field-readonly" data-withdraw-lock>—</div>
        </div>
        <div class="field field--inline-readonly">
          <span class="field-label">Token</span>
          <div class="field-readonly" data-withdraw-token>—</div>
        </div>
        <div class="field field--inline-readonly">
          <span class="field-label">Available Now</span>
          <div class="field-readonly" data-withdraw-available>—</div>
        </div>
        <label class="field">
          <span class="field-label">Amount (tokens)</span>
          <input class="field-input" data-withdraw-amount type="number" min="0" step="any" placeholder="Enter amount" />
        </label>
        <label class="field">
          <span class="field-label">Percent (0-100)</span>
          <input class="field-input" data-withdraw-percent type="number" min="0" max="100" step="0.01" placeholder="Enter percent" />
        </label>
        <label class="field field--full">
          <span class="field-label">Withdraw To (optional)</span>
          <input class="field-input" data-withdraw-to placeholder="Defaults to withdraw address" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-withdraw-max>Use 100%</button>
        <button type="button" class="btn btn--success" data-withdraw-submit>Withdraw</button>
      </div>
    `;
  }

  _renderRetractFormHtml() {
    return `
      <div class="form-grid">
        <div class="field field--inline-readonly">
          <span class="field-label">Lock ID</span>
          <div class="field-readonly" data-retract-id>—</div>
        </div>
        <label class="field">
          <span class="field-label">Retract To (optional)</span>
          <input class="field-input" data-retract-to placeholder="Defaults to creator" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--danger" data-retract-submit>Retract</button>
      </div>
    `;
  }

  _renderLockFormHtml() {
    return `
      <div class="form-grid">
        <label class="field field--full">
          <span class="field-label">Token Address</span>
          <input class="field-input" data-lock-token placeholder="Enter token address (0x...)" />
        </label>
        <label class="field field--inline-readonly">
          <span class="field-label">Token Symbol</span>
          <div class="field-readonly" data-lock-symbol>—</div>
        </label>
        <label class="field field--inline-readonly">
          <span class="field-label">Token Decimals</span>
          <div class="field-readonly" data-lock-decimals>—</div>
        </label>
        <label class="field">
          <span class="field-label">Amount (tokens)</span>
          <input class="field-input" data-lock-amount type="number" min="0" step="any" placeholder="Enter amount" />
        </label>
        <label class="field">
          <span class="field-label">Cliff (days)</span>
          <input class="field-input" data-lock-cliff type="number" min="0" step="1" placeholder="Enter cliff days" />
        </label>
        <label class="field">
          <span class="field-label">Vesting Duration (days)</span>
          <input class="field-input" data-lock-duration type="number" min="1" step="1" placeholder="Enter vesting duration (e.g. 365 days)" />
        </label>
        <label class="field field--inline-readonly">
          <span class="field-label">Daily %</span>
          <div class="field-readonly" data-lock-rate-pct>—</div>
        </label>
        <label class="field field--full">
          <span class="field-label">Withdraw Address (optional)</span>
          <input class="field-input" data-lock-withdraw placeholder="Defaults to your wallet" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" data-lock-submit>Lock</button>
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
      const lockId = Number(this._activeWithdrawLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      this._lock = lock;
      this._setWithdrawTokenDisplay(lock.token);
      await this._ensureTokenMeta(lock.token);
      this._setWithdrawTokenDisplay(lock.token);
      await this._refreshWithdrawAvailable();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load lock'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _refreshWithdrawAvailable() {
    try {
      const lockId = Number(this._activeWithdrawLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadWithdrawLock();
      }
      const available = await window.contractManager.previewWithdrawable(lockId);
      if (available == null) return;
      const formatted = window.ethers.utils.formatUnits(available, this._tokenMeta.decimals || 18);
      if (this.withdrawAvailableDisplay) {
        this.withdrawAvailableDisplay.textContent = formatted;
      }
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to fetch available amount'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _submitWithdraw() {
    try {
      const lockId = Number(this._activeWithdrawLockId);
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
        timeoutMs: 5000,
      });
      if (this._withdrawFormToastId) {
        window.toastManager?.dismiss?.(this._withdrawFormToastId);
        this._withdrawFormToastId = null;
      }
      window.overviewTab?.refreshLocks?.();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Withdraw failed'));
      window.toastManager?.error(msg, { title: 'Withdraw failed' });
    }
  }

  async _submitRetract() {
    try {
      const lockId = Number(this._activeRetractLockId);
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

  _updateLockRate() {
    const duration = Number(this.lockDurationInput?.value || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      if (this.lockRatePctInput) this.lockRatePctInput.textContent = '—';
      return;
    }
    const rate = Math.floor(RATE_SCALE / duration);
    const pct = (rate / RATE_SCALE) * 100;
    this.lockRatePctInput.textContent = `${pct.toFixed(6)}%`;
  }

  _scheduleLockTokenMetaLoad() {
    if (this._lockFormTokenMetaTimer) {
      clearTimeout(this._lockFormTokenMetaTimer);
    }
    const token = (this.lockTokenInput?.value || '').trim();
    const normalized = this._normalizeAddress(token);
    if (!normalized) {
      this._clearLockTokenMeta();
      return;
    }
    this._lockFormTokenMetaTimer = setTimeout(() => {
      this._lockFormTokenMetaTimer = null;
      this._loadLockTokenMeta();
    }, 350);
  }

  async _loadLockTokenMeta() {
    const token = (this.lockTokenInput?.value || '').trim();
    if (!token) return;
    const normalized = this._normalizeAddress(token);
    if (!normalized) {
      this._clearLockTokenMeta();
      return;
    }
    if (this._lockFormTokenMeta._token === normalized) return;
    try {
      const meta = await window.contractManager.getTokenMetadata(normalized);
      this._lockFormTokenMeta = { ...(meta || { symbol: '', decimals: null }), _token: normalized };
      this.lockDecimalsInput.textContent = meta?.decimals == null ? '—' : String(meta.decimals);
      this.lockSymbolInput.textContent = meta?.symbol || '—';
    } catch (err) {
      this._clearLockTokenMeta();
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load token metadata'));
      window.toastManager?.error(msg, { title: 'Token lookup failed' });
    }
  }

  async _submitLock() {
    try {
      const tokenInput = (this.lockTokenInput?.value || '').trim();
      const token = this._normalizeAddress(tokenInput);
      const amount = Number(this.lockAmountInput?.value || 0);
      const cliffDays = Number(this.lockCliffInput?.value || 0);
      const durationDays = Number(this.lockDurationInput?.value || 0);
      const ratePerDay = Number.isFinite(durationDays) && durationDays > 0
        ? Math.floor(RATE_SCALE / durationDays)
        : 0;
      const withdrawAddress = (this.lockWithdrawInput?.value || '').trim();

      if (!token) throw new Error('Token address required');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');
      if (!Number.isFinite(cliffDays) || cliffDays < 0) throw new Error('Invalid cliff');
      if (!ratePerDay || ratePerDay <= 0) throw new Error('Invalid rate');

      const meta = await this._ensureLockFormTokenMeta(token);
      if (meta.decimals == null) throw new Error('Load token info first');

      const parsedAmount = window.ethers.utils.parseUnits(amount.toString(), meta.decimals);
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
          ratePerDay,
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
        if (this._lockFormToastId) {
          window.toastManager?.dismiss?.(this._lockFormToastId);
          this._lockFormToastId = null;
        }
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

  async _ensureLockFormTokenMeta(token) {
    if (!this._lockFormTokenMeta || this._lockFormTokenMeta._token !== token) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._lockFormTokenMeta = { ...(meta || { symbol: '', decimals: null }), _token: token };
      this.lockDecimalsInput.textContent = this._lockFormTokenMeta.decimals == null
        ? '—'
        : String(this._lockFormTokenMeta.decimals);
      this.lockSymbolInput.textContent = this._lockFormTokenMeta.symbol || '—';
    }
    return this._lockFormTokenMeta;
  }

  _clearLockTokenMeta() {
    this._lockFormTokenMeta = { symbol: '', decimals: null, _token: '' };
    if (this.lockDecimalsInput) this.lockDecimalsInput.textContent = '—';
    if (this.lockSymbolInput) this.lockSymbolInput.textContent = '—';
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

  async _ensureTokenMeta(token) {
    if (!this._tokenMeta || this._tokenMeta._token !== token) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta = { ...(meta || { symbol: '', decimals: 18 }), _token: token };
    }
    return this._tokenMeta;
  }

  _setWithdrawTokenDisplay(token) {
    if (!this.withdrawTokenDisplay) return;
    const address = String(token || '');
    if (!address) {
      this.withdrawTokenDisplay.textContent = '—';
      return;
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const symbol = this._tokenMeta?._token === address ? this._tokenMeta.symbol : '';
    this.withdrawTokenDisplay.textContent = symbol ? `${symbol} (${short})` : short;
  }
}

import { CONFIG } from '../config.js';
import { readTokenMetaCache, writeTokenMetaCache } from '../utils/token-meta-cache.js';
import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';
import { setFieldError, clearFieldError, clearFormErrors } from '../utils/form-validation.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UNLOCK_TIME_BUFFER_SECONDS = 60;

export class LockActionToasts {
  constructor() {
    this._lock = null;
    this._tokenMeta = { symbol: '', decimals: 18 };
    this._lockFormTokenMeta = { symbol: '', decimals: null, _token: '' };
    this._lockFormTokenMetaTimer = null;
    this._withdrawAvailable = null;
    this._withdrawInputSource = null;
    this._withdrawSyncing = false;
  }

  load() {
    // No-op: actions are triggered via toasts on the Overview list.
  }

  clearLocalCache() {
    if (this._lockFormTokenMetaTimer) {
      clearTimeout(this._lockFormTokenMetaTimer);
      this._lockFormTokenMetaTimer = null;
    }
    this._tokenMeta = { symbol: '', decimals: 18 };
    this._lockFormTokenMeta = { symbol: '', decimals: null, _token: '' };
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

    clearFormErrors([this.unlockTimeInput]);
    this.unlockTimeInput?.addEventListener('input', () => {
      clearFieldError(this.unlockTimeInput);
      this._enforceUnlockTimeMin();
    });
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
    this._withdrawAvailable = null;
    this._withdrawInputSource = null;
    this._withdrawSyncing = false;

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

    clearFormErrors([this.withdrawAmountInput, this.withdrawPercentInput, this.withdrawToInput]);

    this.withdrawAmountInput?.addEventListener('input', () => this._handleWithdrawAmountInput());
    this.withdrawPercentInput?.addEventListener('input', () => this._handleWithdrawPercentInput());
    this.withdrawToInput?.addEventListener('input', () => clearFieldError(this.withdrawToInput));
    this.withdrawMaxBtn?.addEventListener('click', () => {
      this._handleWithdrawMaxClick();
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

    clearFormErrors([this.retractToInput]);
    this.retractToInput?.addEventListener('input', () => clearFieldError(this.retractToInput));
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
    this.lockRetractDisableUnlockInput = root.querySelector('[data-lock-retract-disable-unlock]');
    this.lockRetractDisableWithdrawInput = root.querySelector('[data-lock-retract-disable-withdraw]');
    this.lockSubmitBtn = root.querySelector('[data-lock-submit]');

    if (this._lockFormTokenMetaTimer) {
      clearTimeout(this._lockFormTokenMetaTimer);
      this._lockFormTokenMetaTimer = null;
    }
    this._clearLockTokenMeta();
    this._updateLockRate();
    this._lockRetractPolicyTouched = false;
    this._lockRetractPolicyApplying = false;
    this._lockWithdrawTouched = false;

    clearFormErrors([
      this.lockTokenInput,
      this.lockAmountInput,
      this.lockCliffInput,
      this.lockDurationInput,
      this.lockWithdrawInput,
    ]);

    this.lockDurationInput?.addEventListener('input', () => {
      clearFieldError(this.lockDurationInput);
      this._updateLockRate();
    });
    this.lockTokenInput?.addEventListener('input', () => {
      clearFieldError(this.lockTokenInput);
      this._scheduleLockTokenMetaLoad();
    });
    this.lockTokenInput?.addEventListener('blur', () => this._loadLockTokenMeta());
    this.lockAmountInput?.addEventListener('input', () => clearFieldError(this.lockAmountInput));
    this.lockCliffInput?.addEventListener('input', () => clearFieldError(this.lockCliffInput));
    this.lockWithdrawInput?.addEventListener('input', () => clearFieldError(this.lockWithdrawInput));
    this.lockWithdrawInput?.addEventListener('input', () => {
      this._lockWithdrawTouched = true;
      this._applyRetractDisableDefault();
    });
    this.lockRetractDisableUnlockInput?.addEventListener('change', () => this._handleRetractDisableUnlockChange());
    this.lockRetractDisableWithdrawInput?.addEventListener('change', () => this._handleRetractDisableWithdrawChange());
    this._applyRetractDisableDefault({ force: true });
    this.lockSubmitBtn?.addEventListener('click', () => this._submitLock());
  }

  _renderUnlockFormHtml() {
    return `
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Unlock Time</span>
          <input class="field-input" data-unlock-time type="datetime-local" step="60" />
          <span class="field-message"></span>
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
          <span class="field-message"></span>
        </label>
        <label class="field">
          <span class="field-label">Percent (0-100)</span>
          <input class="field-input" data-withdraw-percent type="number" min="0" max="100" step="0.01" placeholder="Enter percent" />
          <span class="field-message"></span>
        </label>
        <label class="field field--full">
          <span class="field-label">Withdraw To (optional)</span>
          <input class="field-input" data-withdraw-to placeholder="Defaults to withdraw address" />
          <span class="field-message"></span>
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
          <span class="field-message"></span>
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
          <span class="field-message"></span>
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
          <span class="field-message"></span>
        </label>
        <label class="field">
          <span class="field-label">Cliff (days)</span>
          <input class="field-input" data-lock-cliff type="number" min="0" step="1" placeholder="Enter cliff days" />
          <span class="field-message"></span>
        </label>
        <label class="field">
          <span class="field-label">Vesting Duration (days)</span>
          <input class="field-input" data-lock-duration type="number" min="1" step="1" placeholder="Enter vesting duration (e.g. 365 days)" />
          <span class="field-message"></span>
        </label>
        <label class="field field--inline-readonly">
          <span class="field-label">Daily %</span>
          <div class="field-readonly" data-lock-rate-pct>—</div>
        </label>
        <label class="field field--full">
          <span class="field-label">Withdraw Address (optional)</span>
          <input class="field-input" data-lock-withdraw placeholder="Defaults to your wallet" />
          <span class="field-message"></span>
        </label>
        <div class="field field--full">
          <span class="field-label">Disable retract after</span>
          <div class="field-options">
            <label class="field-option">
              <input type="checkbox" data-lock-retract-disable-unlock />
              <span>Unlock</span>
            </label>
            <label class="field-option">
              <input type="checkbox" data-lock-retract-disable-withdraw />
              <span>First withdraw</span>
            </label>
          </div>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" data-lock-submit>Lock</button>
      </div>
    `;
  }

  async _submitUnlock() {
    const validation = this._validateUnlockForm();
    if (!validation.ok) return;

    try {
      const lockId = Number(this._activeLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const chainNow = await this._getChainTimestamp();
      const minUnlockTime = chainNow + UNLOCK_TIME_BUFFER_SECONDS;
      let unlockTime = validation.values.unlockTime;
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
      window.overviewTab?.refreshLocks?.({ force: true });
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
      this._withdrawAvailable = available;
      const formatted = window.ethers.utils.formatUnits(available, this._tokenMeta.decimals || 18);
      if (this.withdrawAvailableDisplay) {
        this.withdrawAvailableDisplay.textContent = formatted;
      }
      this._syncWithdrawFromSource();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to fetch available amount'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _submitWithdraw() {
    const validation = this._validateWithdrawForm();
    if (!validation.ok) return;

    try {
      const lockId = Number(this._activeWithdrawLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      if (!this._lock) {
        await this._loadWithdrawLock();
      }

      const {
        amountStr,
        percentStr,
        to,
        source,
      } = validation.values;

      let amount = window.ethers.BigNumber.from(0);
      let percent = 0;

      if (source === 'amount') {
        await this._ensureTokenMeta(this._lock.token);
        amount = window.ethers.utils.parseUnits(amountStr, this._tokenMeta.decimals || 18);
        percent = 0;
      } else {
        const pct = Number(percentStr);
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
      window.overviewTab?.refreshLocks?.({ force: true });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Withdraw failed'));
      window.toastManager?.error(msg, { title: 'Withdraw failed' });
    }
  }

  async _submitRetract() {
    const validation = this._validateRetractForm();
    if (!validation.ok) return;

    try {
      const lockId = Number(this._activeRetractLockId);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      const { to } = validation.values;

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
      window.overviewTab?.refreshLocks?.({ force: true });
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Retract failed'));
      window.toastManager?.error(msg, { title: 'Retract failed' });
    }
  }

  _updateLockRate() {
    const durationRaw = (this.lockDurationInput?.value || '').trim();
    const duration = Number(durationRaw);
    if (!durationRaw || !Number.isFinite(duration) || duration <= 0) {
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
      const cached = readTokenMetaCache(normalized);
      if (cached) {
        this._lockFormTokenMeta = { ...cached, _token: normalized };
        this.lockDecimalsInput.textContent = cached.decimals == null ? '—' : String(cached.decimals);
        this.lockSymbolInput.textContent = cached.symbol || '—';
        return;
      }
      const meta = await window.contractManager.getTokenMetadata(normalized);
      const resolved = meta || { symbol: '', decimals: 18 };
      this._lockFormTokenMeta = { ...resolved, _token: normalized };
      this.lockDecimalsInput.textContent = resolved.decimals == null ? '—' : String(resolved.decimals);
      this.lockSymbolInput.textContent = resolved.symbol || '—';
      writeTokenMetaCache(normalized, resolved);
    } catch (err) {
      this._clearLockTokenMeta();
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load token metadata'));
      window.toastManager?.error(msg, { title: 'Token lookup failed' });
    }
  }

  async _submitLock() {
    const validation = this._validateLockForm();
    if (!validation.ok) return;

    try {
      const {
        token,
        amount,
        cliffDays,
        ratePerDay,
        withdrawAddress,
      } = validation.values;
      let retractUntilUnlock = !!this.lockRetractDisableUnlockInput?.checked;
      if (!retractUntilUnlock && !this.lockRetractDisableWithdrawInput?.checked) {
        retractUntilUnlock = false;
      }

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
          retractUntilUnlock,
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
        window.overviewTab?.refreshLocks?.({ force: true });
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
      const cached = readTokenMetaCache(token);
      if (cached) {
        this._lockFormTokenMeta = { ...cached, _token: token };
        return this._lockFormTokenMeta;
      }
      const meta = await window.contractManager.getTokenMetadata(token);
      const resolved = meta || { symbol: '', decimals: 18 };
      this._lockFormTokenMeta = { ...resolved, _token: token };
      writeTokenMetaCache(token, resolved);
      this.lockDecimalsInput.textContent = this._lockFormTokenMeta.decimals == null
        ? '—'
        : String(this._lockFormTokenMeta.decimals);
      this.lockSymbolInput.textContent = this._lockFormTokenMeta.symbol || '—';
    }
    return this._lockFormTokenMeta;
  }

  _validateUnlockForm() {
    clearFormErrors([this.unlockTimeInput]);
    const raw = (this.unlockTimeInput?.value || '').trim();
    const unlockTime = this._parseUnlockInputToSeconds();
    if (!raw) {
      setFieldError(this.unlockTimeInput, 'Unlock time is required.');
      return { ok: false };
    }
    if (!Number.isFinite(unlockTime) || unlockTime <= 0) {
      setFieldError(this.unlockTimeInput, 'Unlock time is invalid.');
      return { ok: false };
    }
    return { ok: true, values: { unlockTime } };
  }

  _validateWithdrawForm() {
    clearFormErrors([this.withdrawAmountInput, this.withdrawPercentInput, this.withdrawToInput]);
    const amountStr = (this.withdrawAmountInput?.value || '').trim();
    const percentStr = (this.withdrawPercentInput?.value || '').trim();
    const toRaw = (this.withdrawToInput?.value || '').trim();

    let ok = true;
    const hasAmount = amountStr !== '';
    const hasPercent = percentStr !== '';
    let source = this._withdrawInputSource;

    if (!source) {
      if (hasAmount && !hasPercent) source = 'amount';
      if (hasPercent && !hasAmount) source = 'percent';
    }
    if (source === 'amount' && !hasAmount && hasPercent) source = 'percent';
    if (source === 'percent' && !hasPercent && hasAmount) source = 'amount';

    if (!hasAmount && !hasPercent) {
      ok = false;
      setFieldError(this.withdrawAmountInput, 'Enter an amount or percent.');
      setFieldError(this.withdrawPercentInput, 'Enter an amount or percent.');
    }

    if (source === 'amount') {
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        ok = false;
        setFieldError(this.withdrawAmountInput, 'Amount must be greater than 0.');
      }
    }

    if (source === 'percent') {
      const pct = Number(percentStr);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        ok = false;
        setFieldError(this.withdrawPercentInput, 'Percent must be between 0 and 100.');
      }
    }

    let to = '';
    if (toRaw) {
      to = this._normalizeAddress(toRaw);
      if (!to) {
        ok = false;
        setFieldError(this.withdrawToInput, 'Withdraw address is not valid.');
      }
    }

    if (!ok) return { ok };
    return {
      ok,
      values: {
        amountStr,
        percentStr,
        to,
        source: source || (hasAmount ? 'amount' : 'percent'),
      },
    };
  }

  _validateRetractForm() {
    clearFormErrors([this.retractToInput]);
    const toRaw = (this.retractToInput?.value || '').trim();
    let to = '';
    if (toRaw) {
      to = this._normalizeAddress(toRaw);
      if (!to) {
        setFieldError(this.retractToInput, 'Retract address is not valid.');
        return { ok: false };
      }
    }
    return { ok: true, values: { to } };
  }

  _validateLockForm() {
    clearFormErrors([
      this.lockTokenInput,
      this.lockAmountInput,
      this.lockCliffInput,
      this.lockDurationInput,
      this.lockWithdrawInput,
    ]);

    const tokenInput = (this.lockTokenInput?.value || '').trim();
    const token = this._normalizeAddress(tokenInput);
    const amountRaw = (this.lockAmountInput?.value || '').trim();
    const cliffRaw = (this.lockCliffInput?.value || '').trim();
    const durationRaw = (this.lockDurationInput?.value || '').trim();
    const withdrawRaw = (this.lockWithdrawInput?.value || '').trim();

    let ok = true;

    if (!tokenInput) {
      ok = false;
      setFieldError(this.lockTokenInput, 'Token address is required.');
    } else if (!token) {
      ok = false;
      setFieldError(this.lockTokenInput, 'Enter a valid token address.');
    }

    const amountBad = !!this.lockAmountInput?.validity?.badInput || amountRaw === '-' || amountRaw === '+';
    const amount = Number(amountRaw);
    if (amountBad) {
      ok = false;
      setFieldError(this.lockAmountInput, 'Enter a valid amount.');
    } else if (!amountRaw) {
      ok = false;
      setFieldError(this.lockAmountInput, 'Amount is required.');
    } else if (!Number.isFinite(amount) || amount <= 0) {
      ok = false;
      setFieldError(this.lockAmountInput, 'Amount must be greater than 0.');
    }

    const cliffBad = !!this.lockCliffInput?.validity?.badInput || cliffRaw === '-' || cliffRaw === '+';
    let cliffDays = 0;
    if (cliffBad) {
      ok = false;
      setFieldError(this.lockCliffInput, 'Cliff must be a whole number ≥ 0.');
    } else if (!cliffRaw) {
      ok = false;
      setFieldError(this.lockCliffInput, 'Cliff is required (use 0 if none).');
    } else {
      cliffDays = Number(cliffRaw);
      if (!Number.isFinite(cliffDays) || cliffDays < 0) {
        ok = false;
        setFieldError(this.lockCliffInput, 'Cliff must be 0 or more days.');
      } else if (!Number.isInteger(cliffDays)) {
        ok = false;
        setFieldError(this.lockCliffInput, 'Cliff must be a whole number of days.');
      }
    }

    const durationBad = !!this.lockDurationInput?.validity?.badInput || durationRaw === '-' || durationRaw === '+';
    const durationDays = Number(durationRaw);
    if (durationBad) {
      ok = false;
      setFieldError(this.lockDurationInput, 'Vesting duration must be a whole number of days.');
    } else if (!durationRaw) {
      ok = false;
      setFieldError(this.lockDurationInput, 'Vesting duration is required.');
    } else if (!Number.isFinite(durationDays) || durationDays <= 0) {
      ok = false;
      setFieldError(this.lockDurationInput, 'Vesting duration must be at least 1 day.');
    } else if (!Number.isInteger(durationDays)) {
      ok = false;
      setFieldError(this.lockDurationInput, 'Vesting duration must be a whole number of days.');
    }

    let ratePerDay = 0;
    if (Number.isFinite(durationDays) && durationDays > 0) {
      ratePerDay = Math.floor(RATE_SCALE / durationDays);
      if (ratePerDay <= 0) {
        ok = false;
        setFieldError(this.lockDurationInput, 'Vesting duration is too long for a daily rate.');
      }
    }

    let withdrawAddress = '';
    if (withdrawRaw) {
      withdrawAddress = this._normalizeAddress(withdrawRaw);
      if (!withdrawAddress) {
        ok = false;
        setFieldError(this.lockWithdrawInput, 'Withdraw address is not valid.');
      }
    }

    if (!ok) return { ok };
    return {
      ok,
      values: {
        token,
        amount,
        cliffDays,
        durationDays,
        ratePerDay,
        withdrawAddress,
      },
    };
  }

  _clearLockTokenMeta() {
    this._lockFormTokenMeta = { symbol: '', decimals: null, _token: '' };
    if (this.lockDecimalsInput) this.lockDecimalsInput.textContent = '—';
    if (this.lockSymbolInput) this.lockSymbolInput.textContent = '—';
  }

  _handleRetractDisableUnlockChange() {
    if (this._lockRetractPolicyApplying) return;
    this._lockRetractPolicyTouched = true;
    const checked = !!this.lockRetractDisableUnlockInput?.checked;
    this._lockRetractPolicyApplying = true;
    if (this.lockRetractDisableWithdrawInput) {
      this.lockRetractDisableWithdrawInput.checked = !checked;
    }
    this._lockRetractPolicyApplying = false;
  }

  _handleRetractDisableWithdrawChange() {
    if (this._lockRetractPolicyApplying) return;
    this._lockRetractPolicyTouched = true;
    const checked = !!this.lockRetractDisableWithdrawInput?.checked;
    this._lockRetractPolicyApplying = true;
    if (this.lockRetractDisableUnlockInput) {
      this.lockRetractDisableUnlockInput.checked = !checked;
    }
    this._lockRetractPolicyApplying = false;
  }

  _applyRetractDisableDefault({ force = false } = {}) {
    if (!this.lockRetractDisableUnlockInput || !this.lockRetractDisableWithdrawInput) return;
    if (this._lockRetractPolicyTouched && !force) return;

    const rawWithdraw = (this.lockWithdrawInput?.value || '').trim();
    const normalizedWithdraw = rawWithdraw ? this._normalizeAddress(rawWithdraw) : '';
    if (rawWithdraw && !normalizedWithdraw) return;

    const creator = this._getCurrentAddress();
    let sameAsCreator = false;
    if (normalizedWithdraw) {
      sameAsCreator = !!creator && normalizedWithdraw.toLowerCase() === creator;
    } else {
      sameAsCreator = !!creator;
    }

    if (this._lockWithdrawTouched && normalizedWithdraw && sameAsCreator) return;

    this._setRetractDisableSelection({ preferUnlock: sameAsCreator });
  }

  _setRetractDisableSelection({ preferUnlock } = {}) {
    this._lockRetractPolicyApplying = true;
    if (this.lockRetractDisableUnlockInput) this.lockRetractDisableUnlockInput.checked = !!preferUnlock;
    if (this.lockRetractDisableWithdrawInput) this.lockRetractDisableWithdrawInput.checked = !preferUnlock;
    this._lockRetractPolicyApplying = false;
  }

  _getCurrentAddress() {
    return (window.walletManager?.getAddress?.() || '').toLowerCase();
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
      const cached = readTokenMetaCache(token);
      if (cached) {
        this._tokenMeta = { ...cached, _token: token };
        return this._tokenMeta;
      }
      const meta = await window.contractManager.getTokenMetadata(token);
      const resolved = meta || { symbol: '', decimals: 18 };
      this._tokenMeta = { ...resolved, _token: token };
      writeTokenMetaCache(token, resolved);
    }
    return this._tokenMeta;
  }

  _handleWithdrawAmountInput() {
    if (!this.withdrawAmountInput) return;
    clearFieldError(this.withdrawAmountInput);
    if (this._withdrawSyncing) return;
    this._withdrawInputSource = 'amount';
    this._syncWithdrawPercentFromAmount();
  }

  _handleWithdrawPercentInput() {
    if (!this.withdrawPercentInput) return;
    clearFieldError(this.withdrawPercentInput);
    if (this._withdrawSyncing) return;
    this._withdrawInputSource = 'percent';
    this._syncWithdrawAmountFromPercent();
  }

  _handleWithdrawMaxClick() {
    if (!this.withdrawPercentInput) return;
    clearFieldError(this.withdrawPercentInput);
    this._withdrawInputSource = 'percent';
    this._withWithdrawSyncing(() => {
      this.withdrawPercentInput.value = '100';
    });
    this._syncWithdrawAmountFromPercent();
  }

  _syncWithdrawFromSource() {
    if (this._withdrawInputSource === 'amount') {
      this._syncWithdrawPercentFromAmount();
    } else if (this._withdrawInputSource === 'percent') {
      this._syncWithdrawAmountFromPercent();
    }
  }

  _syncWithdrawPercentFromAmount() {
    if (!this.withdrawAmountInput || !this.withdrawPercentInput) return;
    const amountStr = (this.withdrawAmountInput.value || '').trim();
    if (!amountStr) {
      this._withWithdrawSyncing(() => {
        this.withdrawPercentInput.value = '';
      });
      return;
    }
    const percentStr = this._calculatePercentFromAmount(amountStr);
    this._withWithdrawSyncing(() => {
      this.withdrawPercentInput.value = percentStr;
    });
  }

  _syncWithdrawAmountFromPercent() {
    if (!this.withdrawAmountInput || !this.withdrawPercentInput) return;
    const percentStr = (this.withdrawPercentInput.value || '').trim();
    if (!percentStr) {
      this._withWithdrawSyncing(() => {
        this.withdrawAmountInput.value = '';
      });
      return;
    }
    const amountStr = this._calculateAmountFromPercent(percentStr);
    this._withWithdrawSyncing(() => {
      this.withdrawAmountInput.value = amountStr;
    });
  }

  _calculatePercentFromAmount(amountStr) {
    const available = this._withdrawAvailable;
    if (!available || available.isZero?.() || available.toString?.() === '0') return '';
    try {
      const decimals = this._tokenMeta.decimals || 18;
      const amountBn = window.ethers.utils.parseUnits(amountStr, decimals);
      if (amountBn.isZero()) return '0';
      const scaled = amountBn.mul(10000).div(available);
      return this._formatScaledNumber(scaled, 2);
    } catch {
      return '';
    }
  }

  _calculateAmountFromPercent(percentStr) {
    const available = this._withdrawAvailable;
    if (!available || available.isZero?.() || available.toString?.() === '0') return '';
    const pct = Number(percentStr);
    if (!Number.isFinite(pct) || pct <= 0) return '';
    const pctScaled = Math.round(pct * 100);
    try {
      const amountBn = available.mul(pctScaled).div(10000);
      const decimals = this._tokenMeta.decimals || 18;
      const formatted = window.ethers.utils.formatUnits(amountBn, decimals);
      return this._trimTrailingZeros(formatted);
    } catch {
      return '';
    }
  }

  _formatScaledNumber(value, decimals) {
    const raw = String(value);
    if (decimals <= 0) return raw;
    const padded = raw.padStart(decimals + 1, '0');
    const intPart = padded.slice(0, -decimals);
    const fracRaw = padded.slice(-decimals);
    const frac = fracRaw.replace(/0+$/, '');
    return frac ? `${intPart}.${frac}` : intPart;
  }

  _trimTrailingZeros(value) {
    if (!value.includes('.')) return value;
    return value.replace(/\.?0+$/, '');
  }

  _withWithdrawSyncing(fn) {
    this._withdrawSyncing = true;
    try {
      fn();
    } finally {
      this._withdrawSyncing = false;
    }
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

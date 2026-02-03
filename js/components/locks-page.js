import { CONFIG } from '../config.js';
import { extractErrorMessage, normalizeErrorMessage, formatTxMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SECONDS_PER_DAY = 86400;

export class LocksPage {
  constructor() {
    this.root = null;
    this._locks = [];
    this._lockIndex = new Map();
    this._tokenMeta = new Map();
    this._tokens = new Set();
    this._scanInFlight = false;
  }

  load() {
    this.root = document.getElementById('locks-page');
    if (!this.root) return;

    this.root.innerHTML = `
      <section class="card" style="margin-bottom:18px;">
        <div class="panel-header">
          <h2>Locks</h2>
          <p class="muted">All locks ordered by oldest unlock time.</p>
        </div>

        <div class="form-grid" style="margin-bottom:12px;">
          <label class="field">
            <span class="field-label">Filters</span>
            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
              <label style="display:flex; gap:8px; align-items:center; font-size: var(--font-size-sm);">
                <input type="checkbox" data-filter-mine /> My locks
              </label>
              <label style="display:flex; gap:8px; align-items:center; font-size: var(--font-size-sm);">
                <input type="checkbox" data-filter-withdraw /> Withdraw address = me
              </label>
            </div>
          </label>
          <label class="field">
            <span class="field-label">Token filter</span>
            <select class="field-input" data-filter-token>
              <option value="">All tokens</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Add token address</span>
            <div style="display:flex; gap:8px;">
              <input class="field-input" data-filter-token-input placeholder="0x..." />
              <button type="button" class="btn" data-filter-token-add>Add</button>
            </div>
          </label>
        </div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
          <button type="button" class="btn" data-refresh-locks>Refresh locks</button>
          <div class="muted" data-locks-status></div>
        </div>

        <div data-locks-list></div>
      </section>

      <section class="card" style="margin-bottom:18px;">
        <div class="panel-header">
          <h2>Lock Tokens</h2>
          <p class="muted">Select a token, configure cliff and vesting, then lock.</p>
        </div>
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
        <div class="actions" style="gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn" data-lock-fetch>Load Token Info</button>
          <button type="button" class="btn" data-lock-approve>Approve</button>
          <button type="button" class="btn btn--primary" data-lock-submit>Lock</button>
        </div>
      </section>

      <section class="card" style="margin-bottom:18px;">
        <div class="panel-header">
          <h2>Unlock</h2>
          <p class="muted">Set the unlock time (Unix seconds) to start the cliff.</p>
        </div>
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
        <div class="actions" style="gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn" data-unlock-now>Set to now + 60s</button>
          <button type="button" class="btn btn--primary" data-unlock-submit>Unlock</button>
        </div>
      </section>

      <section class="card" style="margin-bottom:18px;">
        <div class="panel-header">
          <h2>Withdraw</h2>
          <p class="muted">Withdraw unlocked tokens by amount or percent.</p>
        </div>
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
        <div class="actions" style="gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn" data-withdraw-load>Load Lock</button>
          <button type="button" class="btn" data-withdraw-refresh>Refresh Available</button>
          <button type="button" class="btn" data-withdraw-max>Use 100%</button>
          <button type="button" class="btn btn--primary" data-withdraw-submit>Withdraw</button>
        </div>
      </section>

      <section class="card">
        <div class="panel-header">
          <h2>Retract</h2>
          <p class="muted">Return locked funds if no withdrawals have occurred.</p>
        </div>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">Lock ID</span>
            <input class="field-input" data-retract-id type="number" min="0" step="1" placeholder="0" />
          </label>
          <label class="field field--full">
            <span class="field-label">Withdraw To (optional)</span>
            <input class="field-input" data-retract-to placeholder="Defaults to lock creator" />
          </label>
          <label class="field field--full">
            <span class="field-label">Locked Amount</span>
            <input class="field-input" data-retract-amount readonly />
          </label>
        </div>
        <div class="actions">
          <button type="button" class="btn" data-retract-load>Load Lock</button>
          <button type="button" class="btn btn--primary" data-retract-submit>Retract</button>
        </div>
      </section>
    `;

    this._bind();
    this._updateRate();
    this.refreshLocks();
  }

  _bind() {
    this.locksListEl = this.root.querySelector('[data-locks-list]');
    this.statusEl = this.root.querySelector('[data-locks-status]');
    this.refreshBtn = this.root.querySelector('[data-refresh-locks]');
    this.filterMine = this.root.querySelector('[data-filter-mine]');
    this.filterWithdraw = this.root.querySelector('[data-filter-withdraw]');
    this.filterToken = this.root.querySelector('[data-filter-token]');
    this.filterTokenInput = this.root.querySelector('[data-filter-token-input]');
    this.filterTokenAdd = this.root.querySelector('[data-filter-token-add]');

    this.refreshBtn?.addEventListener('click', () => this.refreshLocks());
    this.filterMine?.addEventListener('change', () => this.renderLocks());
    this.filterWithdraw?.addEventListener('change', () => this.renderLocks());
    this.filterToken?.addEventListener('change', () => this.renderLocks());
    this.filterTokenAdd?.addEventListener('click', () => this._addTokenFilter());

    this.tokenInput = this.root.querySelector('[data-lock-token]');
    this.decimalsInput = this.root.querySelector('[data-lock-decimals]');
    this.symbolInput = this.root.querySelector('[data-lock-symbol]');
    this.amountInput = this.root.querySelector('[data-lock-amount]');
    this.cliffInput = this.root.querySelector('[data-lock-cliff]');
    this.durationInput = this.root.querySelector('[data-lock-duration]');
    this.rateInput = this.root.querySelector('[data-lock-rate]');
    this.ratePctInput = this.root.querySelector('[data-lock-rate-pct]');
    this.withdrawInput = this.root.querySelector('[data-lock-withdraw]');
    this.fetchBtn = this.root.querySelector('[data-lock-fetch]');
    this.approveBtn = this.root.querySelector('[data-lock-approve]');
    this.lockSubmitBtn = this.root.querySelector('[data-lock-submit]');

    this.durationInput?.addEventListener('input', () => this._updateRate());
    this.fetchBtn?.addEventListener('click', () => this._loadTokenMeta());
    this.approveBtn?.addEventListener('click', () => this._approve());
    this.lockSubmitBtn?.addEventListener('click', () => this._submitLock());

    this.unlockIdInput = this.root.querySelector('[data-unlock-id]');
    this.unlockTimeInput = this.root.querySelector('[data-unlock-time]');
    this.unlockNowBtn = this.root.querySelector('[data-unlock-now]');
    this.unlockSubmitBtn = this.root.querySelector('[data-unlock-submit]');

    this.unlockNowBtn?.addEventListener('click', () => this._setUnlockNow());
    this.unlockSubmitBtn?.addEventListener('click', () => this._submitUnlock());

    this.withdrawIdInput = this.root.querySelector('[data-withdraw-id]');
    this.withdrawTokenInput = this.root.querySelector('[data-withdraw-token]');
    this.withdrawAmountInput = this.root.querySelector('[data-withdraw-amount]');
    this.withdrawPercentInput = this.root.querySelector('[data-withdraw-percent]');
    this.withdrawToInput = this.root.querySelector('[data-withdraw-to]');
    this.withdrawAvailableInput = this.root.querySelector('[data-withdraw-available]');
    this.withdrawLoadBtn = this.root.querySelector('[data-withdraw-load]');
    this.withdrawRefreshBtn = this.root.querySelector('[data-withdraw-refresh]');
    this.withdrawMaxBtn = this.root.querySelector('[data-withdraw-max]');
    this.withdrawSubmitBtn = this.root.querySelector('[data-withdraw-submit]');

    this.withdrawLoadBtn?.addEventListener('click', () => this._loadWithdrawLock());
    this.withdrawRefreshBtn?.addEventListener('click', () => this._refreshWithdrawAvailable());
    this.withdrawMaxBtn?.addEventListener('click', () => {
      this.withdrawPercentInput.value = '100';
      this.withdrawAmountInput.value = '';
    });
    this.withdrawSubmitBtn?.addEventListener('click', () => this._submitWithdraw());

    this.retractIdInput = this.root.querySelector('[data-retract-id]');
    this.retractToInput = this.root.querySelector('[data-retract-to]');
    this.retractAmountInput = this.root.querySelector('[data-retract-amount]');
    this.retractLoadBtn = this.root.querySelector('[data-retract-load]');
    this.retractSubmitBtn = this.root.querySelector('[data-retract-submit]');

    this.retractLoadBtn?.addEventListener('click', () => this._loadRetractLock());
    this.retractSubmitBtn?.addEventListener('click', () => this._submitRetract());

    document.addEventListener('walletConnected', () => this.renderLocks());
    document.addEventListener('walletAccountChanged', () => this.renderLocks());
  }

  _setStatus(message) {
    if (this.statusEl) this.statusEl.textContent = message || '';
  }

  async refreshLocks() {
    if (this._scanInFlight) return;
    this._scanInFlight = true;
    this._setStatus('Loading active locks...');

    try {
      const count = await window.contractManager.getActiveLockCount();
      if (count == null) throw new Error('Contract not ready');

      const ids = [];
      const pageSize = 50;
      for (let offset = 0; offset < count; offset += pageSize) {
        this._setStatus(`Loading locks ${offset + 1} - ${Math.min(count, offset + pageSize)}...`);
        const batch = await window.contractManager.getActiveLockIds(offset, pageSize);
        ids.push(...batch);
      }

      await this._loadLocks(ids);
      this._setStatus(`Loaded ${this._locks.length} locks.`);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load locks'));
      window.toastManager?.error(msg, { title: 'Load failed' });
      this._setStatus('Load failed.');
    } finally {
      this._scanInFlight = false;
    }
  }

  async _loadLocks(lockIds) {
    const contract = window.contractManager.getReadContract();
    if (!contract) return;

    const locks = [];
    for (const id of lockIds) {
      try {
        const lock = await contract.getLock(id);
        if (!lock || lock.creator === ZERO_ADDRESS) continue;
        locks.push({ id, lock });
        this._tokens.add(lock.token.toLowerCase());
      } catch {
        // ignore
      }
    }

    this._locks = locks;
    this._lockIndex = new Map(locks.map((l) => [l.id, l.lock]));
    this._refreshTokenFilterOptions();
    await this._primeTokenMeta();
    await this._primeAvailable();
    this.renderLocks();
  }

  async _primeTokenMeta() {
    for (const addr of this._tokens) {
      if (this._tokenMeta.has(addr)) continue;
      try {
        const meta = await window.contractManager.getTokenMetadata(addr);
        this._tokenMeta.set(addr, meta || { symbol: '', decimals: 18 });
      } catch {
        this._tokenMeta.set(addr, { symbol: '', decimals: 18 });
      }
    }
  }

  async _primeAvailable() {
    for (const entry of this._locks) {
      try {
        const v = await window.contractManager.previewWithdrawable(entry.id);
        entry.available = v;
      } catch {
        entry.available = null;
      }
    }
  }

  _refreshTokenFilterOptions() {
    if (!this.filterToken) return;
    const current = this.filterToken.value;
    const opts = Array.from(this._tokens.values()).sort();
    this.filterToken.innerHTML = '<option value="">All tokens</option>';
    opts.forEach((addr) => {
      const meta = this._tokenMeta.get(addr) || { symbol: '' };
      const label = meta.symbol ? `${meta.symbol} (${addr.slice(0, 6)}…${addr.slice(-4)})` : addr;
      const opt = document.createElement('option');
      opt.value = addr;
      opt.textContent = label;
      this.filterToken.appendChild(opt);
    });
    if (current) this.filterToken.value = current;
  }

  renderLocks() {
    if (!this.locksListEl) return;
    const filterToken = (this.filterToken?.value || '').toLowerCase();
    const onlyMine = !!this.filterMine?.checked;
    const onlyWithdraw = !!this.filterWithdraw?.checked;
    const me = (window.walletManager?.getAddress?.() || '').toLowerCase();

    let rows = this._locks.slice();

    if (filterToken) {
      rows = rows.filter((l) => l.lock.token.toLowerCase() === filterToken);
    }

    if (onlyMine && me) {
      rows = rows.filter((l) => l.lock.creator.toLowerCase() === me);
    }

    if (onlyWithdraw && me) {
      rows = rows.filter((l) => l.lock.withdrawAddress.toLowerCase() === me);
    }

    rows.sort((a, b) => {
      const at = Number(a.lock.unlockTime?.toString?.() ?? a.lock.unlockTime ?? 0);
      const bt = Number(b.lock.unlockTime?.toString?.() ?? b.lock.unlockTime ?? 0);
      const aKey = at > 0 ? at : Number.MAX_SAFE_INTEGER;
      const bKey = bt > 0 ? bt : Number.MAX_SAFE_INTEGER;
      return aKey - bKey;
    });

    if (rows.length === 0) {
      this.locksListEl.innerHTML = '<p class="muted">No locks found.</p>';
      return;
    }

    this.locksListEl.innerHTML = rows.map((entry) => this._renderLockRow(entry)).join('');

    this.locksListEl.querySelectorAll('[data-copy]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._copyAddress(btn.dataset.copy));
    });
    this.locksListEl.querySelectorAll('[data-unlock-btn]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._prefillUnlock(btn.dataset.unlockId));
    });
  }

  _renderLockRow(entry) {
    const lock = entry.lock;
    const meta = this._tokenMeta.get(lock.token.toLowerCase()) || { symbol: '', decimals: 18 };
    const fmt = (v) => window.ethers.utils.formatUnits(v || 0, meta.decimals || 18);
    const amount = fmt(lock.amount);
    const withdrawn = fmt(lock.withdrawn);
    const remaining = fmt(window.ethers.BigNumber.from(lock.amount).sub(lock.withdrawn));
    const available = entry.available ? fmt(entry.available) : '0';

    const unlockTime = Number(lock.unlockTime?.toString?.() ?? lock.unlockTime ?? 0);
    const cliffDays = Number(lock.cliffDays?.toString?.() ?? lock.cliffDays ?? 0);
    const ratePerDay = Number(lock.ratePerDay?.toString?.() ?? lock.ratePerDay ?? 0);

    const unlockDate = unlockTime > 0 ? new Date(unlockTime * 1000) : null;
    const cliffEnd = unlockTime > 0 ? unlockTime + cliffDays * SECONDS_PER_DAY : null;
    const vestingDays = ratePerDay > 0 ? Math.ceil(RATE_SCALE / ratePerDay) : 0;
    const vestingEnd = cliffEnd ? cliffEnd + vestingDays * SECONDS_PER_DAY : null;

    const cliffMonths = cliffDays ? (cliffDays / 30).toFixed(1) : '0';
    const dailyPct = ratePerDay ? ((ratePerDay / RATE_SCALE) * 100).toFixed(4) : '0.0000';
    const vestingMonths = vestingDays ? (vestingDays / 30).toFixed(1) : '0';

    const withdrawShort = `${lock.withdrawAddress.slice(0, 6)}…${lock.withdrawAddress.slice(-4)}`;
    const me = (window.walletManager?.getAddress?.() || '').toLowerCase();
    const canUnlock = me && lock.creator.toLowerCase() === me && !lock.unlocked;

    return `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <div class="panel-header" style="margin-bottom:6px;">
              <h2 style="font-size: var(--font-size-lg);">Lock #${entry.id}</h2>
              <p class="muted">Token: ${meta.symbol || 'ERC20'} (${lock.token.slice(0, 6)}…${lock.token.slice(-4)})</p>
            </div>
            <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
              <div class="field">
                <span class="field-label">Unlock date</span>
                <div class="field-input">${unlockDate ? unlockDate.toLocaleString() : 'Not unlocked'}</div>
              </div>
              <div class="field">
                <span class="field-label">Amount left</span>
                <div class="field-input" title="Initial: ${amount}">${remaining}</div>
              </div>
              <div class="field">
                <span class="field-label">Available now</span>
                <div class="field-input">${available}</div>
              </div>
              <div class="field">
                <span class="field-label">Cliff</span>
                <div class="field-input">${cliffMonths} months</div>
              </div>
              <div class="field">
                <span class="field-label">Vesting rate</span>
                <div class="field-input">${dailyPct}% per day</div>
              </div>
              <div class="field">
                <span class="field-label">Vesting duration</span>
                <div class="field-input">${vestingMonths} months${vestingEnd ? ` (ends ${new Date(vestingEnd * 1000).toLocaleDateString()})` : ''}</div>
              </div>
              <div class="field">
                <span class="field-label">Withdraw address</span>
                <div class="field-input" title="${lock.withdrawAddress}">
                  ${withdrawShort} <button type="button" class="btn btn--ghost btn--icon" data-copy="${lock.withdrawAddress}">Copy</button>
                </div>
              </div>
              <div class="field">
                <span class="field-label">Withdrawn</span>
                <div class="field-input">${withdrawn}</div>
              </div>
              <div class="field">
                <span class="field-label">Creator</span>
                <div class="field-input">${lock.creator.slice(0, 6)}…${lock.creator.slice(-4)}</div>
              </div>
            </div>
          </div>
          <div style="align-self:flex-start;">
            ${canUnlock ? `<button type="button" class="btn btn--primary" data-unlock-btn data-unlock-id="${entry.id}">Unlock</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  _addTokenFilter() {
    const addr = (this.filterTokenInput?.value || '').trim().toLowerCase();
    if (!addr) return;
    if (!this._tokens.has(addr)) {
      this._tokens.add(addr);
      this._refreshTokenFilterOptions();
      this.filterToken.value = addr;
      this.renderLocks();
    }
    this.filterTokenInput.value = '';
  }

  async _copyAddress(addr) {
    try {
      await navigator.clipboard.writeText(addr);
      window.toastManager?.success('Address copied', { title: 'Copied' });
    } catch {
      window.toastManager?.error('Failed to copy', { title: 'Copy failed' });
    }
  }

  async _prefillUnlock(lockId) {
    this.unlockIdInput.value = String(lockId);
    await this._setUnlockNow();
    window.toastManager?.success('Unlock form prefilled.', { title: 'Unlock' });
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
        this._tokenMeta.set(token.toLowerCase(), meta);
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
      const meta = await this._ensureTokenMeta(token);

      const parsed = window.ethers.utils.parseUnits(
        amount.toString(),
        meta.decimals || 18
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

  async _submitLock() {
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

      const meta = await this._ensureTokenMeta(token);
      const parsedAmount = window.ethers.utils.parseUnits(
        amount.toString(),
        meta.decimals || 18
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
      this.refreshLocks();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Lock failed'));
      window.toastManager?.error(msg, { title: 'Lock failed' });
    }
  }

  async _setUnlockNow() {
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

  async _submitUnlock() {
    try {
      const lockId = Number(this.unlockIdInput?.value || 0);
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
      this.refreshLocks();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Unlock failed'));
      window.toastManager?.error(msg, { title: 'Unlock failed' });
    }
  }

  async _loadWithdrawLock() {
    try {
      const lockId = Number(this.withdrawIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');

      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      this._withdrawLock = lock;
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
      const available = await window.contractManager.previewWithdrawable(lockId);
      const meta = await this._ensureTokenMeta(this.withdrawTokenInput.value);
      const formatted = window.ethers.utils.formatUnits(available || 0, meta.decimals || 18);
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
        const meta = await this._ensureTokenMeta(this.withdrawTokenInput.value);
        amount = window.ethers.utils.parseUnits(amountStr, meta.decimals || 18);
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
      this.refreshLocks();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Withdraw failed'));
      window.toastManager?.error(msg, { title: 'Withdraw failed' });
    }
  }

  async _loadRetractLock() {
    try {
      const lockId = Number(this.retractIdInput?.value || 0);
      if (!Number.isFinite(lockId) || lockId < 0) throw new Error('Invalid lock ID');
      const lock = await window.contractManager.getLock(lockId);
      if (!lock || !lock.token) throw new Error('Lock not found');

      const meta = await this._ensureTokenMeta(lock.token);
      const remaining = window.ethers.BigNumber.from(lock.amount).sub(lock.withdrawn);
      this.retractAmountInput.value = window.ethers.utils.formatUnits(remaining, meta.decimals || 18);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load lock'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    }
  }

  async _submitRetract() {
    try {
      const lockId = Number(this.retractIdInput?.value || 0);
      const to = (this.retractToInput?.value || '').trim();
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
      this.refreshLocks();
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Retract failed'));
      window.toastManager?.error(msg, { title: 'Retract failed' });
    }
  }

  async _ensureTokenMeta(token) {
    const key = (token || '').toLowerCase();
    if (!key) return { symbol: '', decimals: 18 };
    if (!this._tokenMeta.has(key)) {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta.set(key, meta || { symbol: '', decimals: 18 });
    }
    return this._tokenMeta.get(key);
  }
}

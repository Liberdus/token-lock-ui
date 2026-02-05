import { CONFIG } from '../config.js';
import { readTokenMetaCache, writeTokenMetaCache } from '../utils/token-meta-cache.js';
import { extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';

const RATE_SCALE = 1_000_000_000_000;
const SECONDS_PER_DAY = 86400;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class OverviewTab {
  constructor() {
    this.panel = null;
    this._locks = [];
    this._lockIndex = new Map();
    this._tokenMeta = new Map();
    this._tokens = new Set();
    this._expandedLockDetails = new Set();
    this._scanInFlight = false;
    this._hasLoaded = false;
    this._currentPage = 1;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="overview"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <section class="card" style="margin-bottom:12px;">
        <div class="panel-header">
          <div class="card-title-row">
            <h2>Active Locks</h2>
            <button type="button" class="btn btn--ghost btn--footer" data-overview-refresh>Refresh</button>
          </div>
          <p class="muted">All locks ordered by newest first.</p>
        </div>

        <div class="lock-filters">
          <div class="lock-filter-group">
            <span class="field-label">Filters</span>
            <div class="lock-filter-options">
              <label class="lock-filter-option" data-disabled-reason="">
                <input type="checkbox" data-filter-mine-or-withdraw /> My locks
              </label>
              <label class="lock-filter-option hidden" data-disabled-reason="">
                <input type="checkbox" data-filter-mine /> My locks
              </label>
              <label class="lock-filter-option hidden" data-disabled-reason="">
                <input type="checkbox" data-filter-withdraw /> Withdraw address = me
              </label>
            </div>
          </div>
          <label class="lock-filter-field">
            <span class="field-label">Token</span>
            <select class="field-input" data-filter-token>
              <option value="">All tokens</option>
            </select>
          </label>
        </div>

        <div data-locks-list></div>
      </section>

      <section class="card pagination-card">
        <div class="pagination-row">
          <div class="pagination-left">
            <span class="field-label">Items to show</span>
            <select class="field-input pagination-select" data-overview-page-size>
              <option value="5">5</option>
              <option value="10" selected>10</option>
              <option value="20">20</option>
              <option value="all">All</option>
            </select>
            <span class="pagination-count" data-overview-count>0 / 0</span>
          </div>
          <div class="pagination-actions">
            <span class="disabled-action" data-disabled-reason="">
              <button type="button" class="btn btn--ghost" data-overview-load-more>Load more</button>
            </span>
          </div>
        </div>
      </section>
    `;

    this._bind();
    this._setCount(0, 0);
    this.refreshLocks();
  }

  clearLocalCache() {
    this._tokenMeta.clear();
    this._tokens.clear();
  }

  _bind() {
    this.locksListEl = this.panel.querySelector('[data-locks-list]');
    this.refreshBtn = this.panel.querySelector('[data-overview-refresh]');
    this.filterMine = this.panel.querySelector('[data-filter-mine]');
    this.filterWithdraw = this.panel.querySelector('[data-filter-withdraw]');
    this.filterMineOrWithdraw = this.panel.querySelector('[data-filter-mine-or-withdraw]');
    this.filterToken = this.panel.querySelector('[data-filter-token]');
    this.pageSizeSelect = this.panel.querySelector('[data-overview-page-size]');
    this.countEl = this.panel.querySelector('[data-overview-count]');
    this.loadMoreBtn = this.panel.querySelector('[data-overview-load-more]');

    this.refreshBtn?.addEventListener('click', () => this.refreshLocks({ force: true }));
    this.filterMine?.addEventListener('change', () => {
      this._savePreferences();
      this._resetAndRender();
    });
    this.filterWithdraw?.addEventListener('change', () => {
      this._savePreferences();
      this._resetAndRender();
    });
    this.filterMineOrWithdraw?.addEventListener('change', () => this._handleMineOrWithdrawToggle());
    this.filterToken?.addEventListener('change', () => this._resetAndRender());
    this.pageSizeSelect?.addEventListener('change', () => {
      this._savePreferences();
      this._resetAndRender();
    });
    this.loadMoreBtn?.addEventListener('click', () => this._loadMore());

    this.panel.addEventListener('click', (e) => this._handleDisabledClick(e));
    this._updateFilterState();
    if (this._restorePreferences()) {
      this._resetAndRender();
    }

    document.addEventListener('walletConnected', () => {
      this._updateFilterState();
      const restored = this._restorePreferences();
      if (restored) {
        this._resetAndRender();
      } else {
        this.renderLocks();
      }
    });
    document.addEventListener('walletAccountChanged', () => {
      this._updateFilterState();
      const restored = this._restorePreferences();
      if (restored) {
        this._resetAndRender();
      } else {
        this.renderLocks();
      }
    });
    document.addEventListener('walletDisconnected', () => {
      this._updateFilterState();
      this.renderLocks();
    });
  }

  async _ensureTokenMeta(token) {
    const key = (token || '').toLowerCase();
    if (!key) return { symbol: '', decimals: 18 };
    if (!this._tokenMeta.has(key)) {
      const cached = readTokenMetaCache(key);
      if (cached) {
        this._tokenMeta.set(key, cached);
        return cached;
      }
      const meta = await window.contractManager.getTokenMetadata(token);
      const resolved = meta || { symbol: '', decimals: 18 };
      this._tokenMeta.set(key, resolved);
      writeTokenMetaCache(key, resolved);
    }
    return this._tokenMeta.get(key);
  }

  _setLoading(isLoading, message = 'Loading locks…') {
    if (this.refreshBtn) this.refreshBtn.disabled = !!isLoading;
    if (!this.locksListEl) return;
    this.locksListEl.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (!isLoading) {
      if (!this._hasLoaded) {
        this.locksListEl.innerHTML = '<p class="muted">No locks loaded.</p>';
      }
      return;
    }
    this.locksListEl.innerHTML = `
      <div class="muted" style="display:flex; align-items:center; gap:8px;">
        <span class="notification-icon" aria-hidden="true"><span class="spinner"></span></span>
        <span>${message}</span>
      </div>
    `;
  }

  async refreshLocks({ force = false } = {}) {
    if (this._scanInFlight) return;
    if (this._hasLoaded && !force) {
      this.renderLocks();
      return;
    }
    this._scanInFlight = true;
    this._setLoading(true);

    try {
      const count = await window.contractManager.getActiveLockCount();
      if (count == null) throw new Error('Contract not ready');

      const ids = [];
      const pageSize = 50;
      for (let offset = 0; offset < count; offset += pageSize) {
        const batch = await window.contractManager.getActiveLockIds(offset, pageSize);
        ids.push(...batch);
      }

      await this._loadLocks(ids);
      this._hasLoaded = true;
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load locks'));
      window.toastManager?.error(msg, { title: 'Load failed' });
    } finally {
      this._scanInFlight = false;
      this._setLoading(false);
      if (this._hasLoaded) {
        this.renderLocks();
      }
    }
  }

  async _loadLocks(lockIds) {
    const manager = window.contractManager;
    const locks = [];
    const lockData = typeof manager?.getLocksBatch === 'function'
      ? await manager.getLocksBatch(lockIds)
      : await Promise.all(lockIds.map(async (id) => manager.getLock(id).catch(() => null)));
    this._tokens = new Set();

    lockIds.forEach((id, idx) => {
      const lock = lockData?.[idx];
      if (!lock || !lock.creator || !lock.token) return;
      locks.push({ id, lock });
      this._tokens.add(lock.token.toLowerCase());
    });

    this._locks = locks;
    this._lockIndex = new Map(locks.map((l) => [l.id, l.lock]));
    const validIds = new Set(locks.map((entry) => entry.id));
    this._expandedLockDetails = new Set(
      Array.from(this._expandedLockDetails).filter((id) => validIds.has(id))
    );
    this._refreshTokenFilterOptions();
    await this._primeTokenMeta();
    await this._primeAvailable();
    this._resetAndRender();
  }

  async _primeTokenMeta() {
    const missing = [];
    Array.from(this._tokens.values()).forEach((addr) => {
      if (this._tokenMeta.has(addr)) return;
      const cached = readTokenMetaCache(addr);
      if (cached) {
        this._tokenMeta.set(addr, cached);
        return;
      }
      missing.push(addr);
    });
    if (!missing.length) return;

    if (typeof window.contractManager?.getTokenMetadataBatch === 'function') {
      try {
        const metaMap = await window.contractManager.getTokenMetadataBatch(missing);
        missing.forEach((addr) => {
          const resolved = metaMap.get(addr) || { symbol: '', decimals: 18 };
          this._tokenMeta.set(addr, resolved);
          writeTokenMetaCache(addr, resolved);
        });
        return;
      } catch {
        // Fallback to single calls below.
      }
    }

    for (const addr of missing) {
      try {
        const meta = await window.contractManager.getTokenMetadata(addr);
        const resolved = meta || { symbol: '', decimals: 18 };
        this._tokenMeta.set(addr, resolved);
        writeTokenMetaCache(addr, resolved);
      } catch {
        const fallback = { symbol: '', decimals: 18 };
        this._tokenMeta.set(addr, fallback);
        writeTokenMetaCache(addr, fallback);
      }
    }
  }

  async _primeAvailable() {
    const lockIds = this._locks.map((entry) => entry.id);
    if (!lockIds.length) return;

    if (typeof window.contractManager?.previewWithdrawableBatch === 'function') {
      try {
        const values = await window.contractManager.previewWithdrawableBatch(lockIds);
        this._locks.forEach((entry, idx) => {
          entry.available = values?.[idx] ?? null;
        });
        return;
      } catch {
        // Fallback to single calls below.
      }
    }

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

    if (me && (onlyMine || onlyWithdraw)) {
      rows = rows.filter((l) => {
        const isCreator = l.lock.creator.toLowerCase() === me;
        const isWithdraw = l.lock.withdrawAddress.toLowerCase() === me;
        return (onlyMine && isCreator) || (onlyWithdraw && isWithdraw);
      });
    }

    rows.sort((a, b) => {
      const aId = Number(a.id || 0);
      const bId = Number(b.id || 0);
      return bId - aId;
    });

    const total = rows.length;
    const pageSize = this._getPageSize();
    const showCount = pageSize === 'all' ? total : Math.min(total, pageSize * this._currentPage);
    rows = rows.slice(0, showCount);

    this._setCount(showCount, total);
    this._updateLoadMoreVisibility(showCount, total, pageSize);

    if (rows.length === 0) {
      this.locksListEl.innerHTML = '<p class="muted">No locks found.</p>';
      return;
    }

    this.locksListEl.innerHTML = rows.map((entry) => this._renderLockRow(entry)).join('');

    this.locksListEl.querySelectorAll('[data-copy]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._copyAddress(btn.dataset.copy));
    });
    this.locksListEl.querySelectorAll('[data-lock-details-toggle]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._toggleLockDetails(btn.dataset.lockDetailsToggle));
    });
    this.locksListEl.querySelectorAll('[data-retract-btn]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._openRetractToast(btn.dataset.retractId));
    });
    this.locksListEl.querySelectorAll('[data-unlock-btn]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._openUnlockToast(btn.dataset.unlockId));
    });
    this.locksListEl.querySelectorAll('[data-withdraw-btn]')?.forEach((btn) => {
      btn.addEventListener('click', () => this._openWithdrawToast(btn.dataset.withdrawId));
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
    const amountNum = Number(amount);
    const withdrawnNum = Number(withdrawn);
    const progressPct = Number.isFinite(amountNum) && amountNum > 0
      ? Math.min(100, Math.max(0, (withdrawnNum / amountNum) * 100))
      : 0;

    const unlockTime = Number(lock.unlockTime?.toString?.() ?? lock.unlockTime ?? 0);
    const cliffDays = Number(lock.cliffDays?.toString?.() ?? lock.cliffDays ?? 0);
    const ratePerDay = Number(lock.ratePerDay?.toString?.() ?? lock.ratePerDay ?? 0);

    const unlockDate = unlockTime > 0 ? new Date(unlockTime * 1000) : null;
    const cliffEnd = unlockTime > 0 ? unlockTime + cliffDays * SECONDS_PER_DAY : null;
    const vestingDays = ratePerDay > 0 ? Math.ceil(RATE_SCALE / ratePerDay) : 0;
    const vestingEnd = cliffEnd ? cliffEnd + vestingDays * SECONDS_PER_DAY : null;
    const now = Math.floor(Date.now() / 1000);
    let vestingProgressPct = 0;
    if (vestingEnd && cliffEnd) {
      if (now <= cliffEnd) {
        vestingProgressPct = 0;
      } else if (now >= vestingEnd) {
        vestingProgressPct = 100;
      } else if (vestingEnd > cliffEnd) {
        vestingProgressPct = ((now - cliffEnd) / (vestingEnd - cliffEnd)) * 100;
      }
    }

    const formatDate = (ts) => {
      if (!Number.isFinite(ts) || ts <= 0) return 'n/a';
      return new Date(ts * 1000).toLocaleDateString();
    };

    const hasUnlock = unlockTime > 0;
    const hasCliff = Number.isFinite(cliffEnd) && cliffEnd > unlockTime;
    const hasVestingWindow = Number.isFinite(vestingEnd) && Number.isFinite(cliffEnd) && vestingEnd > cliffEnd;
    const timelineStart = hasUnlock && now >= unlockTime ? unlockTime : now;
    const timelineEndRaw = hasVestingWindow
      ? vestingEnd
      : hasCliff
        ? cliffEnd
        : Math.max(now, hasUnlock ? unlockTime : now);
    const timelineEnd = Math.max(timelineStart + SECONDS_PER_DAY, timelineEndRaw);
    const timelineRange = timelineEnd - timelineStart;
    const timelinePct = (ts) => {
      if (!Number.isFinite(ts) || timelineRange <= 0) return 0;
      const pct = ((ts - timelineStart) / timelineRange) * 100;
      return Math.min(100, Math.max(0, pct));
    };
    const markerEdgeClass = (pct) => {
      if (pct <= 8) return ' lock-vesting-marker--edge-left';
      if (pct >= 92) return ' lock-vesting-marker--edge-right';
      return '';
    };
    const markerOffsetClass = (markerKey, markerOffsets) => markerOffsets.get(markerKey) || '';
    const todayMarkerPct = timelinePct(now);
    const unlockMarkerPct = hasUnlock ? timelinePct(unlockTime) : 0;
    const cliffMarkerPct = hasCliff ? timelinePct(cliffEnd) : 0;
    const vestingEndMarkerPct = hasVestingWindow ? timelinePct(vestingEnd) : 0;
    const showTodayMarker = now < timelineEndRaw;
    const markerOffsets = new Map();
    const markers = [];
    if (hasUnlock) markers.push({ key: 'unlock', pct: unlockMarkerPct });
    if (hasCliff) markers.push({ key: 'cliff', pct: cliffMarkerPct });
    if (hasVestingWindow) markers.push({ key: 'end', pct: vestingEndMarkerPct });
    if (showTodayMarker) markers.push({ key: 'today', pct: todayMarkerPct });
    markers.sort((a, b) => a.pct - b.pct);
    const offsetThresholdPct = 6;
    let clusterIndex = 0;
    markers.forEach((marker, idx) => {
      if (idx === 0) {
        markerOffsets.set(marker.key, '');
        return;
      }
      const prev = markers[idx - 1];
      if (Math.abs(marker.pct - prev.pct) < offsetThresholdPct) {
        clusterIndex += 1;
      } else {
        clusterIndex = 0;
      }
      const offsetClass = clusterIndex === 0
        ? ''
        : clusterIndex % 2 === 1
          ? ' lock-vesting-marker--offset-up'
          : ' lock-vesting-marker--offset-down';
      markerOffsets.set(marker.key, offsetClass);
    });
    const timelineLeftLabel = hasUnlock && now >= unlockTime
      ? `Unlock • ${formatDate(unlockTime)}`
      : `Today • ${formatDate(now)}`;
    const timelineRightLabel = hasVestingWindow
      ? `Vesting end • ${formatDate(vestingEnd)}`
      : hasCliff
        ? `Cliff end • ${formatDate(cliffEnd)}`
        : `Today • ${formatDate(now)}`;

    let vestingPhase = 'Schedule unavailable';
    let scheduleUnavailableReason = '';
    if (hasUnlock && now < unlockTime) vestingPhase = 'Waiting for unlock';
    else if (hasCliff && now < cliffEnd) vestingPhase = 'In cliff period';
    else if (hasVestingWindow && now < vestingEnd) vestingPhase = 'Vesting in progress';
    else if (hasVestingWindow && now >= vestingEnd) vestingPhase = 'Vesting complete';
    else if (hasUnlock) vestingPhase = 'Unlocked';
    else scheduleUnavailableReason = 'unlock time not set';

    if (vestingPhase === 'Schedule unavailable' && scheduleUnavailableReason) {
      vestingPhase = `${vestingPhase} - ${scheduleUnavailableReason}`;
    }

    const nextMilestone = hasVestingWindow ? vestingEnd : (hasCliff ? cliffEnd : (hasUnlock ? unlockTime : null));
    const milestoneName = hasVestingWindow ? 'vesting end' : (hasCliff ? 'cliff end' : 'unlock');
    let milestoneLabel = 'No upcoming milestones';
    if (nextMilestone) {
      const deltaSeconds = nextMilestone - now;
      const dayDelta = deltaSeconds >= 0
        ? Math.ceil(deltaSeconds / SECONDS_PER_DAY)
        : -Math.ceil(Math.abs(deltaSeconds) / SECONDS_PER_DAY);
      if (dayDelta > 0) milestoneLabel = `${dayDelta} day${dayDelta === 1 ? '' : 's'} to ${milestoneName}`;
      else if (dayDelta === 0) milestoneLabel = `${milestoneName[0].toUpperCase()}${milestoneName.slice(1)} is today`;
      else milestoneLabel = `${Math.abs(dayDelta)} day${Math.abs(dayDelta) === 1 ? '' : 's'} since ${milestoneName}`;
    }

    const dailyPct = ratePerDay ? ((ratePerDay / RATE_SCALE) * 100).toFixed(4) : '0.0000';
    const formatMonthsDays = (days) => {
      const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
      if (!safeDays) return '0 days';
      const months = Math.floor(safeDays / 30);
      const remDays = safeDays % 30;
      const parts = [];
      if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
      if (remDays) parts.push(`${remDays} day${remDays === 1 ? '' : 's'}`);
      return parts.join(' ');
    };
    const cliffDurationLabel = formatMonthsDays(cliffDays);
    const vestingDurationLabel = formatMonthsDays(vestingDays);

    const tokenShort = `${lock.token.slice(0, 6)}…${lock.token.slice(-4)}`;
    const withdrawShort = `${lock.withdrawAddress.slice(0, 6)}…${lock.withdrawAddress.slice(-4)}`;
    const creatorShort = `${lock.creator.slice(0, 6)}…${lock.creator.slice(-4)}`;
    const me = this._getCurrentAddress();
    const isCreator = this._isCreator(lock, me);
    const isWithdrawer = this._isWithdrawer(lock, me);
    const showUnlock = !!isCreator;
    const showWithdraw = !!isWithdrawer;
    const showRetract = !!isCreator;
    const unlockUnavailableReason = showUnlock ? this._getUnlockUnavailableReason(lock) : '';
    const withdrawUnavailableReason = showWithdraw ? this._getWithdrawUnavailableReason(lock, entry.available ?? null) : '';
    const retractUnavailableReason = showRetract ? this._getRetractUnavailableReason(lock) : '';
    const detailsExpanded = this._expandedLockDetails.has(entry.id);

    return `
      <div class="card lock-card">
        <div class="lock-header">
          <div>
            <h2 class="lock-title">Lock #${entry.id}</h2>
            <p class="muted lock-address" title="${lock.token}">
              <span>Token: ${meta.symbol || 'ERC20'} (${tokenShort})</span>
              <button type="button" class="btn btn--ghost btn--icon" data-copy="${lock.token}" aria-label="Copy token address">
                <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                </svg>
              </button>
            </p>
          </div>
          <div class="lock-actions">
            ${showRetract ? `
            <button
              type="button"
              class="btn btn--danger${retractUnavailableReason ? ' btn--looks-disabled' : ''}"
              data-retract-btn
              data-retract-id="${entry.id}"
              ${retractUnavailableReason ? 'aria-disabled="true"' : ''}
              title="${retractUnavailableReason || 'Retract this lock'}"
            >Retract</button>
            ` : ''}
            ${showUnlock ? `
              <button
                type="button"
                class="btn btn--primary${unlockUnavailableReason ? ' btn--looks-disabled' : ''}"
                data-unlock-btn
                data-unlock-id="${entry.id}"
                ${unlockUnavailableReason ? 'aria-disabled="true"' : ''}
                title="${unlockUnavailableReason || 'Unlock this lock'}"
              >Unlock</button>
            ` : ''}
            ${showWithdraw ? `
              <button
                type="button"
                class="btn btn--success${withdrawUnavailableReason ? ' btn--looks-disabled' : ''}"
                data-withdraw-btn
                data-withdraw-id="${entry.id}"
                ${withdrawUnavailableReason ? 'aria-disabled="true"' : ''}
                title="${withdrawUnavailableReason || 'Withdraw unlocked tokens'}"
              >Withdraw</button>
            ` : ''}
          </div>
        </div>

        <div class="lock-progress lock-progress--vesting">
          <div class="lock-progress-header">
            <span class="field-label">Vesting progress</span>
            <span class="lock-progress-value">${vestingProgressPct.toFixed(2)}%</span>
          </div>
          <div class="lock-vesting-timeline" role="presentation">
            <div class="lock-vesting-track">
              <span class="lock-vesting-track-fill" style="width:${todayMarkerPct.toFixed(2)}%"></span>
              ${hasUnlock ? `
              <span class="lock-vesting-marker lock-vesting-marker--unlock${markerEdgeClass(unlockMarkerPct)}${markerOffsetClass('unlock', markerOffsets)}" style="left:${unlockMarkerPct.toFixed(2)}%">
                <span class="lock-vesting-marker-dot"></span>
                <span class="lock-vesting-marker-label">Unlock</span>
              </span>
              ` : ''}
              ${hasCliff ? `
              <span class="lock-vesting-marker lock-vesting-marker--cliff${markerEdgeClass(cliffMarkerPct)}${markerOffsetClass('cliff', markerOffsets)}" style="left:${cliffMarkerPct.toFixed(2)}%">
                <span class="lock-vesting-marker-dot"></span>
                <span class="lock-vesting-marker-label">Cliff end</span>
              </span>
              ` : ''}
              ${hasVestingWindow ? `
              <span class="lock-vesting-marker lock-vesting-marker--end${markerEdgeClass(vestingEndMarkerPct)}${markerOffsetClass('end', markerOffsets)}" style="left:${vestingEndMarkerPct.toFixed(2)}%">
                <span class="lock-vesting-marker-dot"></span>
                <span class="lock-vesting-marker-label">Vesting end</span>
              </span>
              ` : ''}
              ${showTodayMarker ? `
              <span class="lock-vesting-marker lock-vesting-marker--today${markerEdgeClass(todayMarkerPct)}${markerOffsetClass('today', markerOffsets)}" style="left:${todayMarkerPct.toFixed(2)}%">
                <span class="lock-vesting-marker-dot"></span>
                <span class="lock-vesting-marker-label">Today</span>
              </span>
              ` : ''}
            </div>
            <div class="lock-vesting-axis">
              <span>${timelineLeftLabel}</span>
              <span>${timelineRightLabel}</span>
            </div>
            <div class="lock-vesting-meta">
              <span>${vestingPhase}</span>
              <span>${milestoneLabel}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="lock-details-toggle"
          data-lock-details-toggle="${entry.id}"
          aria-expanded="${detailsExpanded ? 'true' : 'false'}"
          aria-controls="lock-details-${entry.id}"
          title="Toggle lock details"
        >Lock Details</button>

        <div
          class="lock-grid"
          id="lock-details-${entry.id}"
          ${detailsExpanded ? '' : 'hidden'}
        >
          <div class="lock-group">
            <div class="lock-group-title">Balances</div>
            <div class="lock-kv">
              <div class="field-label">Amount left</div>
              <div class="field-input" title="Initial: ${amount}">${remaining}</div>
            </div>
            <div class="lock-kv">
              <div class="field-label">Available now</div>
              <div class="field-input">${available}</div>
            </div>
            <div class="lock-progress lock-progress--compact">
              <div class="lock-progress-header">
                <span class="field-label">Withdrawn</span>
                <span class="lock-progress-value">${withdrawn} / ${amount} ${meta.symbol || ''}</span>
              </div>
              <div class="lock-progress-bar" role="presentation">
                <span class="lock-progress-fill" style="width:${progressPct.toFixed(2)}%"></span>
              </div>
            </div>
          </div>

          <div class="lock-group">
            <div class="lock-group-title">Schedule</div>
            <div class="lock-kv">
              <div class="field-label">Unlock date</div>
              <div class="field-input">${unlockDate ? unlockDate.toLocaleString() : 'Not unlocked'}</div>
            </div>
            <div class="lock-kv">
              <div class="field-label">Cliff</div>
              <div class="field-input">${cliffDurationLabel}</div>
            </div>
            <div class="lock-kv">
              <div class="field-label">Vesting rate</div>
              <div class="field-input">${dailyPct}% per day</div>
            </div>
            <div class="lock-kv">
              <div class="field-label">Vesting duration</div>
              <div class="field-input">${vestingDurationLabel}${vestingEnd ? ` (ends ${new Date(vestingEnd * 1000).toLocaleDateString()})` : ''}</div>
            </div>
          </div>

          <div class="lock-group">
            <div class="lock-group-title">Parties</div>
            <div class="lock-kv">
              <div class="field-label">Withdraw address</div>
              <div class="field-input lock-address" title="${lock.withdrawAddress}">
                ${withdrawShort}
                <button type="button" class="btn btn--ghost btn--icon" data-copy="${lock.withdrawAddress}" aria-label="Copy address">
                  <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="lock-kv">
              <div class="field-label">Creator</div>
              <div class="field-input lock-address" title="${lock.creator}">
                ${creatorShort}
                <button type="button" class="btn btn--ghost btn--icon" data-copy="${lock.creator}" aria-label="Copy address">
                  <svg class="icon icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8zm-3 9V7a4 4 0 0 1 4-4h7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _toggleLockDetails(lockId) {
    const id = Number(lockId);
    if (!Number.isFinite(id) || id < 0) return;
    if (this._expandedLockDetails.has(id)) {
      this._expandedLockDetails.delete(id);
    } else {
      this._expandedLockDetails.add(id);
    }
    this.renderLocks();
  }

  async _copyAddress(addr) {
    try {
      await navigator.clipboard.writeText(addr);
      window.toastManager?.success('Address copied', { title: 'Copied' });
    } catch {
      window.toastManager?.error('Failed to copy', { title: 'Copy failed' });
    }
  }

  _openUnlockToast(lockId) {
    const id = Number(lockId);
    if (!Number.isFinite(id) || id < 0) return;
    const lock = this._lockIndex.get(id);
    const reason = this._getUnlockUnavailableReason(lock);
    if (reason) {
      this._showActionUnavailable(reason);
      return;
    }
    window.lockActionToasts?.openUnlockToast?.({ lockId: id });
  }

  _openRetractToast(lockId) {
    const id = Number(lockId);
    if (!Number.isFinite(id) || id < 0) return;
    const lock = this._lockIndex.get(id);
    const reason = this._getRetractUnavailableReason(lock);
    if (reason) {
      this._showActionUnavailable(reason);
      return;
    }
    window.lockActionToasts?.openRetractToast?.({ lockId: id });
  }

  async _openWithdrawToast(lockId) {
    const id = Number(lockId);
    if (!Number.isFinite(id) || id < 0) return;
    const entry = this._locks.find((item) => item.id === id) || null;
    const lock = entry?.lock || this._lockIndex.get(id);
    const reason = this._getWithdrawUnavailableReason(lock, entry?.available ?? null);
    if (reason) {
      this._showActionUnavailable(reason);
      return;
    }

    if (entry && (entry.available == null)) {
      try {
        const available = await window.contractManager.previewWithdrawable(id);
        entry.available = available;
        const refreshedReason = this._getWithdrawUnavailableReason(lock, available);
        if (refreshedReason) {
          this._showActionUnavailable(refreshedReason);
          return;
        }
      } catch {
        // Ignore preview errors and allow the withdraw form to load.
      }
    }

    window.lockActionToasts?.openWithdrawToast?.({ lockId: id, lock });
  }

  _getCurrentAddress() {
    return (window.walletManager?.getAddress?.() || '').toLowerCase();
  }

  _isCreator(lock, me = this._getCurrentAddress()) {
    if (!lock || !me) return false;
    return lock.creator?.toLowerCase?.() === me;
  }

  _isWithdrawer(lock, me = this._getCurrentAddress()) {
    if (!lock || !me) return false;
    const withdrawAddress = lock.withdrawAddress?.toLowerCase?.() || '';
    const creatorAddress = lock.creator?.toLowerCase?.() || '';
    return withdrawAddress === me || (withdrawAddress === ZERO_ADDRESS && creatorAddress === me);
  }

  _getUnlockUnavailableReason(lock) {
    if (!lock) return 'Lock not found.';
    if (!this._isCreator(lock)) return 'Only the lock creator can unlock.';
    if (lock.unlocked) return 'This lock has already been unlocked.';
    return '';
  }

  _isZeroAmount(value) {
    if (value == null) return false;
    if (window.ethers?.BigNumber?.from) {
      try {
        return window.ethers.BigNumber.from(value).isZero();
      } catch {
        // Fallback to number parsing below.
      }
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed === 0;
  }

  _getWithdrawUnavailableReason(lock, available = null) {
    if (!lock) return 'Lock not found.';
    if (!this._isWithdrawer(lock)) return 'Only the withdraw address can withdraw.';
    if (!lock.unlocked) return 'This lock is not unlocked.';

    const now = Math.floor(Date.now() / 1000);
    const unlockTime = Number(lock.unlockTime?.toString?.() ?? lock.unlockTime ?? 0);
    const cliffDays = Number(lock.cliffDays?.toString?.() ?? lock.cliffDays ?? 0);
    if (unlockTime > now) return 'Unlock time has not been reached.';
    const cliffEnd = unlockTime > 0 ? unlockTime + (cliffDays * SECONDS_PER_DAY) : 0;
    if (cliffEnd > now) return 'Cliff period is active. Withdrawals start after the cliff ends.';

    if (available != null && this._isZeroAmount(available)) return 'No tokens are available to withdraw right now.';

    return '';
  }

  _getRetractUnavailableReason(lock) {
    if (!lock) return 'Lock not found.';
    if (!this._isCreator(lock)) return 'Only the lock creator can retract.';
    if (lock.retractUntilUnlock && lock.unlocked) return 'Cannot retract after unlock.';
    const withdrawnRaw = lock.withdrawn?.toString?.() ?? lock.withdrawn ?? 0;
    if (!this._isZeroAmount(withdrawnRaw)) return 'Cannot retract after withdrawals have occurred.';
    return '';
  }

  _showActionUnavailable(message) {
    if (!message) return;
    window.toastManager?.show?.({
      type: 'warning',
      title: 'Action unavailable',
      message,
      timeoutMs: 5000,
    });
  }

  _getPageSize() {
    const value = this.pageSizeSelect?.value || '10';
    if (value === 'all') return 'all';
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }

  _setCount(shown, total) {
    if (this.countEl) {
      this.countEl.textContent = `${shown} / ${total}`;
    }
  }

  _updateLoadMoreVisibility(shown, total, pageSize) {
    if (!this.loadMoreBtn) return;
    const isAll = pageSize === 'all';
    const hasMore = !isAll && shown < total;
    const disabled = !hasMore;
    const reason = total === 0
      ? 'No locks to load.'
      : 'All locks loaded.';
    const wrapper = this.loadMoreBtn.closest('[data-disabled-reason]');
    this.loadMoreBtn.disabled = disabled;
    if (disabled) {
      this.loadMoreBtn.setAttribute('aria-disabled', 'true');
      this.loadMoreBtn.style.pointerEvents = 'none';
      this.loadMoreBtn.title = reason;
      wrapper?.setAttribute('data-disabled-reason', reason);
    } else {
      this.loadMoreBtn.removeAttribute('aria-disabled');
      this.loadMoreBtn.style.pointerEvents = '';
      this.loadMoreBtn.title = 'Load more locks';
      wrapper?.setAttribute('data-disabled-reason', '');
    }
  }

  _resetAndRender() {
    this._currentPage = 1;
    this.renderLocks();
  }

  _loadMore() {
    const pageSize = this._getPageSize();
    if (pageSize === 'all') return;
    this._currentPage = (this._currentPage || 1) + 1;
    this.renderLocks();
  }

  _handleDisabledClick(event) {
    const wrapper = event.target?.closest?.('[data-disabled-reason]');
    if (!wrapper) return;
    const reason = wrapper.getAttribute('data-disabled-reason') || '';
    if (!reason) return;

    event.preventDefault();
    window.toastManager?.show?.({
      type: 'warning',
      title: 'Action unavailable',
      message: reason,
      timeoutMs: 5000,
    });
  }

  _updateFilterState() {
    const me = (window.walletManager?.getAddress?.() || '').toLowerCase();
    const disabled = !me;
    const reason = 'Connect your wallet to use this filter.';
    if (this.filterMine) {
      this.filterMine.disabled = disabled;
      this.filterMine.title = disabled ? reason : '';
      this.filterMine.closest('[data-disabled-reason]')?.setAttribute('data-disabled-reason', disabled ? reason : '');
    }
    if (this.filterWithdraw) {
      this.filterWithdraw.disabled = disabled;
      this.filterWithdraw.title = disabled ? reason : '';
      this.filterWithdraw.closest('[data-disabled-reason]')?.setAttribute('data-disabled-reason', disabled ? reason : '');
    }
    if (this.filterMineOrWithdraw) {
      this.filterMineOrWithdraw.disabled = disabled;
      this.filterMineOrWithdraw.title = disabled ? reason : '';
      this.filterMineOrWithdraw.closest('[data-disabled-reason]')?.setAttribute('data-disabled-reason', disabled ? reason : '');
    }
  }

  _handleMineOrWithdrawToggle() {
    if (!this.filterMineOrWithdraw) return;
    const nextChecked = this.filterMineOrWithdraw.checked;
    if (this.filterMine) this.filterMine.checked = nextChecked;
    if (this.filterWithdraw) this.filterWithdraw.checked = nextChecked;
    this._savePreferences();
    this._resetAndRender();
  }

  _restorePreferences() {
    const key = this._getPreferencesKey();
    if (!key) return false;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      let applied = false;

      if (this.pageSizeSelect && parsed?.pageSize != null) {
        const value = String(parsed.pageSize);
        const option = this.pageSizeSelect.querySelector(`option[value="${value}"]`);
        if (option) {
          this.pageSizeSelect.value = value;
          applied = true;
        }
      }

      if (parsed?.mineOrWithdraw != null) {
        const nextChecked = !!parsed.mineOrWithdraw;
        if (this.filterMineOrWithdraw) this.filterMineOrWithdraw.checked = nextChecked;
        if (this.filterMine) this.filterMine.checked = nextChecked;
        if (this.filterWithdraw) this.filterWithdraw.checked = nextChecked;
        applied = true;
      }

      return applied;
    } catch {
      return false;
    }
  }

  _savePreferences() {
    const key = this._getPreferencesKey();
    if (!key) return;
    try {
      const mineOrWithdraw = this.filterMineOrWithdraw
        ? this.filterMineOrWithdraw.checked
        : !!(this.filterMine?.checked || this.filterWithdraw?.checked);
      const payload = {
        pageSize: this.pageSizeSelect?.value || '10',
        mineOrWithdraw,
      };
      window.localStorage?.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }

  _getPreferencesKey() {
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const address = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    const wallet = (window.walletManager?.getAddress?.() || '').toLowerCase();
    if (!chainId || !address || !wallet) return null;
    return `liberdus_token_ui:overview:prefs:v1:${chainId}:${address}:${wallet}`;
  }
}

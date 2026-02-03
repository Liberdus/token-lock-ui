import { CONFIG } from '../config.js';

export class ProposalsTab {
  constructor() {
    this.panel = null;

    this.listEl = null;
    this.loadMoreBtn = null;
    this.statusEl = null;
    this.countEl = null;
    this.refreshBtn = null;
    this.clearCacheBtn = null;

    this.pageSize = 25;
    // Minimum items to show from cache before triggering a fresh load (used in cache restoration logic)
    this.initialMinItems = 5;

    this._isLoading = false;
    this._allLogsLoaded = false; // whether we've fetched full historical logs once

    this._pendingEvents = []; // prefetched but not yet displayed (newest first)
    this._loadedEvents = []; // displayed (newest first)

    this._requiredSignatures = null; // fetched once per session (no persistent caching)

    // Cache / refresh
    this.cacheTtlMs = 5 * 60 * 1000;
    this.cacheMaxItems = 500;
    this._cacheSchemaVersion = 3; // Bumped to invalidate old caches that may have stored values incorrectly

    this._lastFetchedBlock = 0; // latest block number at time of last scan (for incremental refresh)
    this._refreshInFlight = false;
    this._resolvedThroughBlock = 0; // highest block where all proposals at/below are terminal

    // Filters
    this._filterOpType = null; // null = all, or number (0-8)
    this._filterStatus = null; // null = all, or 'Pending', 'Executed', 'Expired'

    // Phase 9.4: lazy tab loading
    this._isActive = false;
    this._needsRefresh = false;
    this._cacheWasFresh = false;
    this._refreshDebounceTimer = null;
    this._lastRefreshAtMs = 0;
    this._activationRefreshMinIntervalMs = 30 * 1000;
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="proposals"]');
    if (!this.panel) return;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Proposals</h2>
        <p class="muted">Click a row for details.</p>
      </div>

      <div class="card">
        <div class="card-title-row">
          <div class="proposals-description">
            <p class="muted">
              Proposals for operations (Mint, Burn, Distribute, etc.) that require multiple signatures to execute.
            </p>
            <div class="proposals-status-list">
              <span class="muted" style="font-size: var(--font-size-sm);">Status: </span>
              <span class="status-items">
                <strong>Pending</strong>, <strong>Executed</strong>, <strong>Expired</strong>
              </span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="muted" data-proposals-status style="display:none;"></div>
            <button type="button" class="btn btn--ghost" data-proposals-refresh title="Refresh proposals">Refresh</button>
          </div>
        </div>
        <div class="proposals-filters">
          <label class="filter-field">
            <span class="filter-label">Operation</span>
            <select class="field-input" data-proposals-filter-optype>
              <option value="">All Operations</option>
              <option value="0">Mint</option>
              <option value="1">Burn</option>
              <option value="8">Distribute</option>
              <option value="2">PostLaunch</option>
              <option value="3">Pause</option>
              <option value="4">Unpause</option>
              <option value="5">SetBridgeInCaller</option>
              <option value="6">SetBridgeInLimits</option>
              <option value="7">UpdateSigner</option>
            </select>
          </label>
          <label class="filter-field">
            <span class="filter-label">Status</span>
            <select class="field-input" data-proposals-filter-status>
              <option value="">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Executed">Executed</option>
              <option value="Expired">Expired</option>
            </select>
          </label>
        </div>
        <div class="proposal-list" data-proposals-list></div>
        <div class="proposal-footer">
          <button type="button" class="btn" data-proposals-load-more>Load more</button>
          <div class="muted" data-proposals-count></div>
        </div>
      </div>
    `;

    this.listEl = this.panel.querySelector('[data-proposals-list]');
    this.loadMoreBtn = this.panel.querySelector('[data-proposals-load-more]');
    this.statusEl = this.panel.querySelector('[data-proposals-status]');
    this.countEl = this.panel.querySelector('[data-proposals-count]');
    this.refreshBtn = this.panel.querySelector('[data-proposals-refresh]');
    this.clearCacheBtn = document.getElementById('proposals-clear-cache');
    this.filterOpTypeEl = this.panel.querySelector('[data-proposals-filter-optype]');
    this.filterStatusEl = this.panel.querySelector('[data-proposals-filter-status]');

    this.loadMoreBtn?.addEventListener('click', () => this.loadMore());
    this.refreshBtn?.addEventListener('click', () => this.refresh());
    this.clearCacheBtn?.addEventListener('click', () => this._clearCacheAndReload());
    this.filterOpTypeEl?.addEventListener('change', () => this._onFilterChange());
    this.filterStatusEl?.addEventListener('change', () => this._onFilterChange());

    // When a signature is submitted from modal, refresh that row.
    document.addEventListener('proposalSigned', async (e) => {
      const opId = e?.detail?.operationId;
      if (!opId) return;
      if (!this._isActive) {
        this._needsRefresh = true;
        return;
      }
      await this.refreshOne(opId);
    });

    // When a new operation is requested (Phase 5), refresh proposals in background.
    document.addEventListener('operationRequested', () => {
      // Mark stale; only hit RPC if the tab is active.
      this._needsRefresh = true;
      if (this._isActive) {
        this._scheduleBackgroundRefresh();
      }
    });

    document.addEventListener('tabActivated', (e) => {
      if (e?.detail?.tabName === 'proposals') this._onActivated();
    });
    document.addEventListener('tabDeactivated', (e) => {
      if (e?.detail?.tabName === 'proposals') this._onDeactivated();
    });

    // Restore filters from localStorage (before loading cache/events)
    this._restoreFilters();

    // Restore cached proposals (if any) for instant reload UX (no RPC here).
    const cache = this._loadCache();
    if (cache) {
      const fresh = this._isCacheFresh(cache);
      this._cacheWasFresh = fresh;
      this._lastRefreshAtMs = Number(cache?.cachedAtMs || 0) || 0;
      this._applyCache(cache);
      this._renderLoadedFromState();
      this._renderCount();
      this._updateLoadMoreVisibility();
      return;
    }

    // First-time visitors: render empty state and wait for activation to fetch.
    this._cacheWasFresh = false;
    this._renderLoadedFromState();
    this._renderCount();
    this._updateLoadMoreVisibility();
    this._setStatus('Ready');
  }

  _onActivated() {
    this._isActive = true;

    // Hydrate visible rows best-effort (only pending/unknown).
    this._ensureRequiredSignaturesAndHydrateVisible().catch(() => {});

    // If we have little/no visible data, load a page now.
    if (this._loadedEvents.length < this.initialMinItems) {
      this.loadMore().catch(() => {});
    }

    // If cache was stale (or an operation was requested while inactive), refresh incrementally.
    // Avoid doing an "incremental refresh" before we've ever loaded anything.
    const hasAnyState = this._lastFetchedBlock > 0 || this._loadedEvents.length > 0 || this._pendingEvents.length > 0;
    const staleForRefresh =
      !this._lastRefreshAtMs || Date.now() - this._lastRefreshAtMs > this._activationRefreshMinIntervalMs;
    if (hasAnyState && (this._needsRefresh || !this._cacheWasFresh || staleForRefresh)) {
      this._scheduleBackgroundRefresh();
    }
  }

  _onDeactivated() {
    this._isActive = false;
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
  }

  _scheduleBackgroundRefresh() {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
    this._refreshDebounceTimer = setTimeout(async () => {
      this._refreshDebounceTimer = null;
      if (!this._isActive) return;
      this._needsRefresh = false;
      try {
        await this._refreshNewEventsInBackground();
        this._cacheWasFresh = true;
        this._lastRefreshAtMs = Date.now();
      } catch {
        // ignore
      }
      this._updateLoadMoreVisibility();
      this._renderCount();
    }, 250);
  }

  async loadMore() {
    if (this._isLoading) return;
    // Allow draining prefetched items even when scanning is finished.
    if (this._allLogsLoaded && this._pendingEvents.length === 0) return;
    await this.loadProposalsPage();
  }

  async loadProposalsPage() {
    if (!this.listEl) return;
    const contractManager = window.contractManager;
    if (!contractManager?.isReady?.()) {
      this._setStatus('Contract not ready');
      return;
    }

    this._isLoading = true;
    this._setStatus('Loading…');
    this.loadMoreBtn.disabled = true;
    const toast = window.toastManager;
    const toastId = toast?.loading?.('Retrieving proposals…', { id: 'proposals-loading', delayMs: 250 });

    try {
      // Fetch all proposals in one getLogs call (if not already loaded), then display first page
      await this._fillPendingUntil(this.pageSize);

      if (this._pendingEvents.length === 0) {
        if (this._loadedEvents.length === 0) {
          this._setStatus('No proposals found');
        } else {
          this._setStatus('Done');
        }
        this._updateLoadMoreVisibility();
        this._renderCount();
        toast?.dismiss?.(toastId);
        return;
      }

      const page = this._pendingEvents.splice(0, this.pageSize); // may be < pageSize
      this._loadedEvents.push(...page);

      // Re-render all loaded events (filtered)
      this._renderLoadedFromState();

      // Ensure required signatures exists (doesn't block initial row render)
      if (this._requiredSignatures == null) {
        this._requiredSignatures = await contractManager.getRequiredSignatures();
      }

      // Hydrate with on-chain details via direct contract calls (only newly loaded page).
      // Filters should be purely client-side and should not trigger extra queries.
      await this._hydrateRows(page.map((e) => e.operationId));

      this._setStatus(this._allLogsLoaded && this._pendingEvents.length === 0 ? 'Done' : 'Ready');
      this._renderCount();
      this._saveCache();
      this._cacheWasFresh = true;
      this._lastRefreshAtMs = Date.now();
      toast?.dismiss?.(toastId);
    } catch (e) {
      this._setStatus('Error loading proposals');
      toast?.update?.(toastId, { type: 'error', title: 'Failed to load', message: e?.message || 'Failed to load proposals', timeoutMs: 0, dismissible: true });
    } finally {
      this._isLoading = false;
      // Update button state after _isLoading is set to false
      this._updateLoadMoreVisibility();
    }
  }

  async _fillPendingUntil(minCount) {
    const contractManager = window.contractManager;
    const provider = contractManager.getReadOnlyProvider();
    const contract = contractManager.getReadContract();
    const floorBlock = this._getScanFloorBlock();

    if (!provider || !contract) return;

    if (this._allLogsLoaded) return;
    // Skip fetch if we already have enough items in pending queue
    if (this._pendingEvents.length >= minCount) return;

    const latest = await provider.getBlockNumber();
    this._lastFetchedBlock = latest;

    // Fetch proposals in one getLogs call; fall back to split ranges if limits are hit
    const topic = contract.interface.getEventTopic('OperationRequested');
    const logs = await getLogsWithFallback(provider, {
      address: contract.address,
      topics: [topic],
      fromBlock: floorBlock,
      toBlock: latest,
    });

    const parsed = this._parseLogs(contract, logs);
    this._pendingEvents.push(...parsed);
    this._pendingEvents = dedupeBy(this._pendingEvents, (x) => x.operationId);
    this._allLogsLoaded = true;
  }

  _parseLogs(contract, logs) {
    const parsed = (logs || [])
      .map((log) => {
        try {
          const ev = contract.interface.parseLog(log);
          const rawValue = ev.args.value || ev.args[4];
          
          // Ensure value is preserved as BigNumber (ethers.js should return BigNumber for uint256, but be defensive)
          let value = rawValue;
          if (rawValue && window.ethers?.BigNumber?.isBigNumber?.(rawValue)) {
            value = rawValue; // Already a BigNumber, keep it
          } else if (rawValue && typeof rawValue === 'object' && rawValue.type === 'BigNumber' && rawValue.hex) {
            // Serialized BigNumber - restore it
            value = window.ethers?.BigNumber?.from?.(rawValue.hex) || rawValue;
          } else if (rawValue != null && window.ethers?.BigNumber) {
            // Convert to BigNumber to preserve precision
            value = window.ethers.BigNumber.from(rawValue);
          }
          
          return {
            operationId: String(ev.args.operationId || ev.args[0]),
            opType: Number(ev.args.opType?.toString?.() ?? ev.args[1]?.toString?.() ?? 0),
            requester: String(ev.args.requester || ev.args[2]),
            target: String(ev.args.target || ev.args[3]),
            value: value,
            data: String(ev.args.data || ev.args[5]),
            deadline: Number((ev.args.deadline || ev.args[6]).toString()),
            timestamp: Number((ev.args.timestamp || ev.args[7]).toString()),
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Sort newest first (block desc, logIndex desc)
    parsed.sort((a, b) => {
      if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
      return (b.logIndex || 0) - (a.logIndex || 0);
    });

    return parsed;
  }

  async _hydrateRows(operationIds) {
    const contractManager = window.contractManager;
    const detailsMap = await contractManager.getOperationsBatch(operationIds);
    const eventMap = new Map(
      [...this._loadedEvents, ...this._pendingEvents].map((ev) => [ev.operationId, ev])
    );

    for (const opId of operationIds) {
      const details = detailsMap.get(opId);
      if (!details) continue;

      const ev = eventMap.get(opId);
      if (ev) {
        const oldStatus =
          ev.executed === true ? 'Executed'
            : (ev.expired === true ? 'Expired'
              : (ev.executed === false && ev.expired === false ? 'Pending' : 'Unknown'));
        ev.executed = !!details.executed;
        ev.expired = !!details.expired;
        ev.numSignatures = Number(details.numSignatures);
        const newStatus =
          ev.executed === true ? 'Executed'
            : (ev.expired === true ? 'Expired'
              : (ev.executed === false && ev.expired === false ? 'Pending' : 'Unknown'));
        
        // If status filter is active and status changed, re-render filtered view
        if (this._filterStatus != null && oldStatus !== newStatus) {
          this._renderLoadedFromState();
          this._renderCount();
        }
      }

      // Update DOM row if it's currently rendered (it may be filtered out).
      const row = this.listEl?.querySelector?.(`[data-proposal-row="${opId}"]`);
      if (row) {
        const required = details.opType === 7 ? 2 : (this._requiredSignatures ?? '?');
        const sigs = `${details.numSignatures}/${required}`;
        row.querySelector('[data-proposal-sigs]')?.replaceChildren(document.createTextNode(sigs));
        row.querySelector('[data-proposal-executed]')?.replaceChildren(
          document.createTextNode(details.executed ? 'Executed' : (details.expired ? 'Expired' : 'Pending'))
        );
      const isExecuted = !!details.executed;
      const isExpired = !!details.expired && !isExecuted;
      row.classList.toggle('is-executed', isExecuted);
      row.classList.toggle('is-expired', isExpired);
      }
    }

    this._recomputeResolvedThroughBlock();
  }

  async refreshOne(operationId) {
    if (!this.listEl) return;
    await this._hydrateRows([operationId]);
  }

  async refresh() {
    if (this._refreshInFlight) return;
    const originalText = this.refreshBtn?.textContent || 'Refresh';
    this.refreshBtn?.setAttribute('disabled', '');
    this.refreshBtn && (this.refreshBtn.textContent = 'Refreshing…');
    try {
      await this._refreshNewEventsInBackground();
      this._updateLoadMoreVisibility();
      this._renderCount();
    } catch (e) {
      this._setStatus('Error refreshing');
      window.toastManager?.error?.('Failed to refresh proposals', { message: e?.message || 'Unknown error', timeoutMs: 0, dismissible: true });
    } finally {
      this.refreshBtn?.removeAttribute('disabled');
      this.refreshBtn && (this.refreshBtn.textContent = originalText);
    }
  }

  async _ensureRequiredSignaturesAndHydrateVisible() {
    const contractManager = window.contractManager;
    if (!contractManager?.isReady?.()) return;

    const visibleEvents = this._loadedEvents.slice(0, this.pageSize);

    if (this._requiredSignatures == null) {
      try {
        this._requiredSignatures = await contractManager.getRequiredSignatures();
      } catch {
        // keep null; UI will display '?' as denominator
      }
    }

    // Update visible rows' denominator immediately once REQUIRED_SIGNATURES is known.
    // This avoids showing `?/` indefinitely when the first page is all terminal ops.
    for (const ev of visibleEvents) {
      const opId = ev?.operationId;
      if (!opId) continue;
      const row = this.listEl?.querySelector?.(`[data-proposal-row="${opId}"]`);
      if (!row) continue;

      const required = Number(ev.opType) === 7 ? 2 : (this._requiredSignatures ?? '?');
      const num = typeof ev.numSignatures === 'number' ? ev.numSignatures : null;
      if (num != null) {
        row.querySelector('[data-proposal-sigs]')?.replaceChildren(document.createTextNode(`${num}/${required}`));
      }
    }

    // Only hydrate rows that can still change (pending/unknown).
    const pendingIds = visibleEvents
      .filter((e) => !(e?.executed === true || e?.expired === true))
      .map((e) => e.operationId)
      .filter(Boolean);
    if (pendingIds.length === 0) return;

    await this._hydrateRows(pendingIds);
  }

  _appendRow(ev) {
    const typeLabel = operationEnumToString(ev.opType);
    const when = ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleString() : '';
    const shortOpId = shortHex(ev.operationId);
    const status =
      ev.executed === true ? 'Executed'
        : (ev.expired === true ? 'Expired'
          : (ev.executed === false && ev.expired === false ? 'Pending' : null));
    const statusText = status || 'Loading…';
    const required = Number(ev.opType) === 7 ? 2 : (this._requiredSignatures ?? '?');
    const sigsText = typeof ev.numSignatures === 'number' ? `${ev.numSignatures}/${required}` : '—';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'proposal-row';
    row.setAttribute('data-proposal-row', ev.operationId);
    row.classList.toggle('is-executed', status === 'Executed');
    row.classList.toggle('is-expired', status === 'Expired' && status !== 'Executed');

    row.innerHTML = `
      <div class="proposal-row-main">
        <div class="proposal-row-top">
          <div class="proposal-opid"><code>${shortOpId}</code></div>
          <div class="proposal-status" data-proposal-executed>${statusText}</div>
        </div>
        <div class="proposal-row-bottom">
          <div class="proposal-meta">${typeLabel} • ${when}</div>
          <div class="proposal-sigs" data-proposal-sigs>${sigsText}</div>
        </div>
      </div>
    `;

    row.addEventListener('click', () => {
      window.proposalDetailModal?.open?.({
        event: ev,
        requiredSignatures: this._requiredSignatures,
      });
    });

    this.listEl.appendChild(row);
  }

  _setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    // Only show status for loading/error states, hide for "Ready" and "Done"
    const shouldShow = text && text !== 'Ready' && text !== 'Done';
    this.statusEl.style.display = shouldShow ? '' : 'none';
  }

  _renderCount() {
    if (!this.countEl) return;
    const filtered = this._getFilteredEvents();
    const shown = filtered.length;
    const total = this._loadedEvents.length;
    const pending = this._pendingEvents.length;
    const suffix = pending > 0 ? ` (+${pending} prefetched)` : '';
    const filterSuffix = shown < total ? ` (filtered from ${total})` : '';
    this.countEl.textContent = `Showing ${shown}${filterSuffix}${suffix}`;
  }

  _updateLoadMoreVisibility() {
    if (!this.loadMoreBtn) return;
    const noMore = this._allLogsLoaded && this._pendingEvents.length === 0;
    this.loadMoreBtn.classList.toggle('hidden', noMore);
    // Enable button if not loading and there are more items (either prefetched or not yet scanned)
    this.loadMoreBtn.disabled = this._isLoading || noMore;
  }

  _renderLoadedFromState() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    const filtered = this._getFilteredEvents();
    for (const ev of filtered) {
      this._appendRow(ev);
    }
  }

  _getFilteredEvents() {
    return this._loadedEvents.filter((ev) => {
      // Filter by operation type
      if (this._filterOpType != null) {
        if (ev.opType !== this._filterOpType) return false;
      }

      // Filter by status
      if (this._filterStatus != null) {
        if (this._filterStatus === 'Executed' && ev.executed !== true) return false;
        if (this._filterStatus === 'Expired' && !(ev.expired === true && ev.executed !== true)) return false;
        if (this._filterStatus === 'Pending' && !(ev.executed !== true && ev.expired !== true)) return false;
      }

      return true;
    });
  }

  _onFilterChange() {
    const opTypeValue = this.filterOpTypeEl?.value || '';
    const statusValue = this.filterStatusEl?.value || '';

    this._filterOpType = opTypeValue === '' ? null : Number(opTypeValue);
    this._filterStatus = statusValue === '' ? null : statusValue;

    this._saveFilters();
    this._renderLoadedFromState();
    this._renderCount();
  }

  _restoreFilters() {
    try {
      const key = this._getFilterCacheKey();
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.opType !== undefined) {
          this._filterOpType = parsed.opType === null ? null : Number(parsed.opType);
          if (this.filterOpTypeEl) {
            this.filterOpTypeEl.value = parsed.opType === null ? '' : String(parsed.opType);
          }
        }
        if (parsed.status !== undefined) {
          this._filterStatus = parsed.status;
          if (this.filterStatusEl) {
            this.filterStatusEl.value = parsed.status || '';
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  _saveFilters() {
    try {
      const key = this._getFilterCacheKey();
      const data = {
        opType: this._filterOpType,
        status: this._filterStatus,
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  _getFilterCacheKey() {
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const address = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    return `liberdus_token_ui:proposals:filters:v1:${chainId}:${address}`;
  }

  _getCacheKey() {
    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const address = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    if (!chainId || !address) return null;
    return `liberdus_token_ui:proposals:v${this._cacheSchemaVersion}:${chainId}:${address}`;
  }

  _isCacheFresh(cache) {
    const ts = Number(cache?.cachedAtMs || 0);
    if (!ts) return false;
    return Date.now() - ts < this.cacheTtlMs;
  }

  _loadCache() {
    const key = this._getCacheKey();
    if (!key) return null;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);

      const schemaOk = Number(parsed?.schemaVersion) === this._cacheSchemaVersion;
      const chainOk = Number(parsed?.chainId) === Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
      const addrOk =
        String(parsed?.contractAddress || '').toLowerCase() === String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
      const depOk = Number(parsed?.deploymentBlock) === Number(CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK || 0);

      if (!schemaOk || !chainOk || !addrOk || !depOk) return null;
      if (!Array.isArray(parsed?.events)) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  _applyCache(cache) {
    const events = Array.isArray(cache?.events) ? cache.events : [];
    
    // Restore BigNumber instances from serialized format (localStorage converts them to {type: 'BigNumber', hex: '...'})
    // Also handle cases where value might be stored as a plain number (shouldn't happen, but defensive)
    const restored = events.map((ev) => {
      if (ev && typeof ev === 'object') {
        const restored = { ...ev };
        // Restore value if it's a serialized BigNumber
        if (restored.value && typeof restored.value === 'object' && restored.value.type === 'BigNumber' && restored.value.hex) {
          try {
            restored.value = window.ethers?.BigNumber?.from?.(restored.value.hex) || restored.value;
          } catch {
            // Keep original if conversion fails
          }
        } else if (typeof restored.value === 'number' && window.ethers?.BigNumber) {
          // If value is stored as a plain number (shouldn't happen, but handle it defensively)
          try {
            restored.value = window.ethers.BigNumber.from(restored.value);
          } catch {
            // Keep original if conversion fails
          }
        } else if (typeof restored.value === 'string' && !restored.value.startsWith('0x') && window.ethers?.BigNumber) {
          // If value is stored as a decimal string, convert to BigNumber
          try {
            restored.value = window.ethers.BigNumber.from(restored.value);
          } catch {
            // Keep original if conversion fails
          }
        }
        return restored;
      }
      return ev;
    });
    
    // Limit initial render to initialMinItems (5) for fast first paint
    // This prevents "Loading..." rows beyond what we hydrate immediately
    const visibleCount = Math.min(this.initialMinItems, restored.length);

    this._loadedEvents = restored.slice(0, visibleCount);
    this._pendingEvents = restored.slice(visibleCount);

    this._allLogsLoaded = !!cache?.allLogsLoaded;
    this._lastFetchedBlock = Number(cache?.lastFetchedBlock || 0) || this._lastFetchedBlock;
    this._resolvedThroughBlock = Number(cache?.resolvedThroughBlock || 0) || this._resolvedThroughBlock;
  }

  _saveCache() {
    const key = this._getCacheKey();
    if (!key) return;

    const chainId = Number(CONFIG?.NETWORK?.CHAIN_ID || 0);
    const contractAddress = String(CONFIG?.CONTRACT?.ADDRESS || '').toLowerCase();
    const deploymentBlock = Number(CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK || 0);
    const opStart = Number(CONFIG?.CONTRACT?.OPERATION_REQUESTED_START_BLOCK || 0) || 0;

    const combined = dedupeBy([...this._loadedEvents, ...this._pendingEvents], (x) => x.operationId);
    const wasTruncated = combined.length > this.cacheMaxItems;
    const capped = combined.slice(0, this.cacheMaxItems);
    const loadedCount = Math.min(this._loadedEvents.length, capped.length);

    const payload = {
      schemaVersion: this._cacheSchemaVersion,
      chainId,
      contractAddress,
      deploymentBlock,
      operationRequestedStartBlock: opStart,
      cachedAtMs: Date.now(),
      lastFetchedBlock: this._lastFetchedBlock || null,
      allLogsLoaded: this._allLogsLoaded,
      resolvedThroughBlock: this._resolvedThroughBlock || null,
      eventsTruncated: wasTruncated,
      loadedCount,
      events: capped,
    };

    try {
      window.localStorage?.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore quota errors; cache is best-effort.
    }
  }

  _clearCacheAndReload() {
    const key = this._getCacheKey();
    if (key) {
      try {
        window.localStorage?.removeItem(key);
      } catch {
        // ignore
      }
    }

    // Reset state
    this._pendingEvents = [];
    this._loadedEvents = [];
    this._allLogsLoaded = false;
    this._requiredSignatures = null;
    this._lastFetchedBlock = 0;
    this._resolvedThroughBlock = 0;

    if (this.listEl) this.listEl.innerHTML = '';
    this._setStatus('Cleared cache');
    this._renderCount();
    this.loadMoreBtn?.classList.remove('hidden');

    // Reload only if tab is active (Phase 9.4 lazy loading).
    if (this._isActive) {
      this.loadMore().catch(() => {});
    } else {
      this._needsRefresh = true;
      this._setStatus('Ready');
    }
  }

  async _refreshNewEventsInBackground() {
    if (this._refreshInFlight) return;
    this._refreshInFlight = true;

    try {
      const contractManager = window.contractManager;
      const provider = contractManager?.getReadOnlyProvider?.();
      const contract = contractManager?.getReadContract?.();
      if (!provider || !contract) return;

      const latestNow = await provider.getBlockNumber();
      if (!latestNow) return;

      const last = Number(this._lastFetchedBlock || 0);
      const floorBlock = this._getScanFloorBlock();
      if (!last || latestNow <= last) {
        // Nothing new; refresh visible hydration only.
        await this._ensureRequiredSignaturesAndHydrateVisible();
        this._setStatus('Ready');
        return;
      }

      const topic = contract.interface.getEventTopic('OperationRequested');
      const logs = await getLogsWithFallback(provider, {
        address: contract.address,
        topics: [topic],
        fromBlock: Math.max(last + 1, floorBlock),
        toBlock: latestNow,
      });

      const newEvents = this._parseLogs(contract, logs);
      if (newEvents.length === 0) {
        this._lastFetchedBlock = latestNow;
        this._saveCache();
        this._setStatus('Ready');
        return;
      }

      const existingIds = new Set(this._loadedEvents.map((e) => e.operationId));
      const toInsert = newEvents.filter((e) => !existingIds.has(e.operationId));

      // Prepend to state
      this._loadedEvents = [...toInsert, ...this._loadedEvents];
      this._lastFetchedBlock = latestNow;

      // Update DOM: insert new rows at top, preserving newest-first ordering.
      if (this.listEl && toInsert.length > 0) {
        for (let i = toInsert.length - 1; i >= 0; i--) {
          const ev = toInsert[i];
          const before = this.listEl.firstChild;
          // Reuse renderer by temporarily appending then moving; simplest to keep behavior consistent.
          this._appendRow(ev);
          const appended = this.listEl.lastChild;
          if (before && appended) this.listEl.insertBefore(appended, before);
        }
      }

      this._renderCount();
      this._saveCache();
      await this._ensureRequiredSignaturesAndHydrateVisible();
      this._setStatus('Ready');
    } finally {
      this._refreshInFlight = false;
    }
  }

  _getScanFloorBlock() {
    const deploymentBlock = Number(CONFIG?.CONTRACT?.DEPLOYMENT_BLOCK || 0);
    const opStartBlock = Number(CONFIG?.CONTRACT?.OPERATION_REQUESTED_START_BLOCK || 0);
    const baseFloor = Math.max(deploymentBlock, opStartBlock || 0);
    const resolvedFloor = Number(this._resolvedThroughBlock || 0);
    return Math.max(baseFloor, resolvedFloor + 1);
  }

  _recomputeResolvedThroughBlock() {
    if (!this._allLogsLoaded) return;

    const combined = dedupeBy([...this._loadedEvents, ...this._pendingEvents], (x) => x.operationId);
    if (combined.length === 0) return;

    // Only advance if we are confident we haven't truncated history.
    if (combined.length >= this.cacheMaxItems && !this._resolvedThroughBlock) return;

    const sorted = combined.slice().sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return (a.logIndex || 0) - (b.logIndex || 0);
    });

    let candidate = null;
    for (const ev of sorted) {
      if (!ev?.blockNumber) continue;
      const isTerminal = ev.executed === true || ev.expired === true;
      if (!isTerminal) break;
      candidate = ev.blockNumber;
    }

    if (candidate != null) {
      this._resolvedThroughBlock = Math.max(this._resolvedThroughBlock || 0, candidate);
    }
  }
}

function operationEnumToString(op) {
  switch (Number(op)) {
    case 0: return 'Mint';
    case 1: return 'Burn';
    case 2: return 'PostLaunch';
    case 3: return 'Pause';
    case 4: return 'Unpause';
    case 5: return 'SetBridgeInCaller';
    case 6: return 'SetBridgeInLimits';
    case 7: return 'UpdateSigner';
    case 8: return 'Distribute';
    default: return 'Unknown';
  }
}

function shortHex(hex) {
  if (!hex) return '';
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

async function getLogsWithFallback(provider, filter) {
  try {
    return await provider.getLogs(filter);
  } catch (error) {
    if (!isLogLimitError(error)) {
      throw error;
    }
  }

  const from = Number(filter.fromBlock);
  const to = Number(filter.toBlock);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error('getLogs fallback failed to split range');
  }

  const mid = Math.floor((from + to) / 2);
  const [left, right] = await Promise.all([
    getLogsWithFallback(provider, { ...filter, fromBlock: from, toBlock: mid }),
    getLogsWithFallback(provider, { ...filter, fromBlock: mid + 1, toBlock: to }),
  ]);

  return [...left, ...right];
}

/**
 * Detect eth_getLogs "too many results" limit errors.
 *
 * Known behavior (from community reports, not always in official provider docs):
 * - Infura: message "query returned more than 10000 results"; some endpoints use RPC code -32005.
 * - Other providers may use different messages or codes.
 *
 * We check message (including nested error.error/data/reason) and code in common
 * nested shapes. If a provider uses a different format, the fallback won't trigger
 * and the error will surface; we can extend checks as needed.
 */
function isLogLimitError(error) {
  if (!error) return false;

  const code = Number(error?.code ?? error?.error?.code ?? error?.data?.code);
  if (code === -32005) return true;

  const message = [
    error?.message,
    error?.reason,
    error?.error?.message,
    error?.error?.data?.message,
    error?.data?.message,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(' ');
  if (!message) return false;

  return (
    message.includes('more than 10000') ||
    message.includes('10000 results') ||
    message.includes('too many results') ||
    /query\s+returned\s+more\s+than\s+\d+\s+result/i.test(message)
  );
}

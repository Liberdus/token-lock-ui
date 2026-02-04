import { CONFIG } from '../config.js';
import { extractErrorMessage, normalizeErrorMessage } from '../utils/transaction-helpers.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class HistoryTab {
  constructor() {
    this.panel = null;
    this._loaded = false;
    this._tokenMeta = new Map();
    this._blockTimeCache = new Map();
  }

  load() {
    this.panel = document.querySelector('.tab-panel[data-panel="history"]');
    if (!this.panel) return;

    document.addEventListener('tabActivated', (e) => {
      const { tabName, isFirstActivation } = e.detail || {};
      if (tabName === 'history' && isFirstActivation) {
        this._init();
      }
    });
  }

  _init() {
    if (this._loaded) return;
    this._loaded = true;

    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>Historical Locks</h2>
        <p class="muted">Closed locks (fully withdrawn or retracted). Loaded on demand.</p>
      </div>

      <div class="card">
        <div class="form-grid" style="margin-bottom: 12px;">
          <label class="field">
            <span class="field-label">From block (optional)</span>
            <input class="field-input" data-history-from type="number" min="0" step="1" placeholder="0" />
          </label>
          <label class="field">
            <span class="field-label">To block (optional)</span>
            <input class="field-input" data-history-to type="number" min="0" step="1" placeholder="latest" />
          </label>
          <label class="field">
            <span class="field-label">Creator filter (optional)</span>
            <input class="field-input" data-history-creator placeholder="0x..." />
          </label>
          <label class="field">
            <span class="field-label">Withdraw address filter (optional)</span>
            <input class="field-input" data-history-withdraw placeholder="0x..." />
          </label>
        </div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
          <button type="button" class="btn" data-history-load>Load history</button>
          <div class="muted" data-history-status></div>
        </div>

        <div data-history-list></div>
      </div>
    `;

    this._bind();
  }

  _bind() {
    this.fromInput = this.panel.querySelector('[data-history-from]');
    this.toInput = this.panel.querySelector('[data-history-to]');
    this.creatorInput = this.panel.querySelector('[data-history-creator]');
    this.withdrawInput = this.panel.querySelector('[data-history-withdraw]');
    this.loadBtn = this.panel.querySelector('[data-history-load]');
    this.statusEl = this.panel.querySelector('[data-history-status]');
    this.listEl = this.panel.querySelector('[data-history-list]');

    this.loadBtn?.addEventListener('click', () => this._loadHistory());
  }

  _setStatus(message) {
    if (this.statusEl) this.statusEl.textContent = message || '';
  }

  async _loadHistory() {
    try {
      const fromBlock = Number(this.fromInput?.value || 0);
      const toBlockRaw = (this.toInput?.value || '').trim();
      const toBlock = toBlockRaw ? Number(toBlockRaw) : 'latest';
      const creatorFilter = (this.creatorInput?.value || '').trim().toLowerCase();
      const withdrawFilter = (this.withdrawInput?.value || '').trim().toLowerCase();

      if (!Number.isFinite(fromBlock) || fromBlock < 0) {
        throw new Error('Invalid from block');
      }
      if (toBlock !== 'latest' && (!Number.isFinite(toBlock) || toBlock < fromBlock)) {
        throw new Error('Invalid to block');
      }

      const provider = window.contractManager.getReadContract()?.provider || window.contractManager.getProvider?.();
      const contract = window.contractManager.getReadContract();
      if (!provider || !contract) throw new Error('Provider not ready');

      const iface = contract.interface;
      const eventTopic = iface.getEventTopic('LockClosed');
      const latest = toBlock === 'latest' ? await provider.getBlockNumber() : toBlock;

      const chunk = 5000;
      const events = [];
      for (let start = fromBlock; start <= latest; start += chunk + 1) {
        const end = Math.min(latest, start + chunk);
        this._setStatus(`Scanning blocks ${start} - ${end}...`);
        const logs = await provider.getLogs({
          address: CONFIG.CONTRACT.ADDRESS,
          fromBlock: start,
          toBlock: end,
          topics: [eventTopic],
        });
        for (const log of logs) {
          try {
            const parsed = iface.parseLog(log);
            const args = parsed.args;
            const creator = String(args.creator).toLowerCase();
            const withdrawAddress = String(args.withdrawAddress).toLowerCase();
            if (creatorFilter && creator !== creatorFilter) continue;
            if (withdrawFilter && withdrawAddress !== withdrawFilter) continue;
            events.push({
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              ...args,
            });
          } catch {
            // ignore
          }
        }
      }

      await this._renderHistory(events, provider);
      this._setStatus(`Loaded ${events.length} closed locks.`);
    } catch (err) {
      const msg = normalizeErrorMessage(extractErrorMessage(err, 'Failed to load history'));
      window.toastManager?.error(msg, { title: 'History load failed' });
      this._setStatus('Load failed.');
    }
  }

  async _renderHistory(events, provider) {
    if (!this.listEl) return;
    if (!events.length) {
      this.listEl.innerHTML = '<p class="muted">No historical locks found.</p>';
      return;
    }

    // Sort newest first (by block)
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    const rows = [];
    for (const e of events) {
      const tokenAddr = String(e.token);
      const meta = await this._getTokenMeta(tokenAddr);
      const fmt = (v) => window.ethers.utils.formatUnits(v || 0, meta.decimals || 18);
      const closedAt = await this._getBlockTime(provider, e.blockNumber);
      const reason = Number(e.reason) === 0 ? 'Withdrawn' : 'Retracted';
      const unlockTime = Number(e.unlockTime || 0);

      rows.push(`
        <div class="card" style="margin-bottom:12px;">
          <div class="panel-header" style="margin-bottom:6px;">
            <h2 style="font-size: var(--font-size-lg);">Lock #${e.lockId}</h2>
            <p class="muted">${reason} • ${closedAt ? new Date(closedAt * 1000).toLocaleString() : 'Unknown time'}</p>
          </div>
          <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
            <div class="field"><span class="field-label">Token</span><div class="field-input">${meta.symbol || 'ERC20'} (${tokenAddr.slice(0,6)}…${tokenAddr.slice(-4)})</div></div>
            <div class="field"><span class="field-label">Amount</span><div class="field-input">${fmt(e.amount)} ${meta.symbol}</div></div>
            <div class="field"><span class="field-label">Withdrawn</span><div class="field-input">${fmt(e.withdrawn)} ${meta.symbol}</div></div>
            <div class="field"><span class="field-label">Cliff Days</span><div class="field-input">${e.cliffDays}</div></div>
            <div class="field"><span class="field-label">Rate Per Day</span><div class="field-input">${e.ratePerDay}</div></div>
            <div class="field"><span class="field-label">Unlock Time</span><div class="field-input">${unlockTime ? new Date(unlockTime * 1000).toLocaleString() : 'Not unlocked'}</div></div>
            <div class="field"><span class="field-label">Creator</span><div class="field-input">${String(e.creator).slice(0,6)}…${String(e.creator).slice(-4)}</div></div>
            <div class="field"><span class="field-label">Withdraw Address</span><div class="field-input">${String(e.withdrawAddress).slice(0,6)}…${String(e.withdrawAddress).slice(-4)}</div></div>
            <div class="field"><span class="field-label">Tx</span><div class="field-input">${String(e.txHash).slice(0,10)}…</div></div>
          </div>
        </div>
      `);
    }

    this.listEl.innerHTML = rows.join('');
  }

  async _getTokenMeta(token) {
    const key = (token || '').toLowerCase();
    if (!key || key === ZERO_ADDRESS) return { symbol: '', decimals: 18 };
    if (this._tokenMeta.has(key)) return this._tokenMeta.get(key);
    try {
      const meta = await window.contractManager.getTokenMetadata(token);
      this._tokenMeta.set(key, meta || { symbol: '', decimals: 18 });
    } catch {
      this._tokenMeta.set(key, { symbol: '', decimals: 18 });
    }
    return this._tokenMeta.get(key);
  }

  async _getBlockTime(provider, blockNumber) {
    if (this._blockTimeCache.has(blockNumber)) return this._blockTimeCache.get(blockNumber);
    try {
      const block = await provider.getBlock(blockNumber);
      this._blockTimeCache.set(blockNumber, block?.timestamp || 0);
      return block?.timestamp || 0;
    } catch {
      this._blockTimeCache.set(blockNumber, 0);
      return 0;
    }
  }
}

/**
 * WalletPopup (Phase 2)
 * Simple MetaMask popup:
 * - address (copy)
 * - balance (native, best-effort)
 * - disconnect
 */

export class WalletPopup {
  constructor({ walletManager, networkManager } = {}) {
    this.walletManager = walletManager || null;
    this.networkManager = networkManager || null;

    this.isOpen = false;
    this.popupEl = null;
    this._containerEl = null;
  }

  load() {
    this._ensureContainer();
    this._attachGlobalClickListener();
    this._attachContainerHandlers();

    document.addEventListener('walletDisconnected', () => this.hide());
    document.addEventListener('walletAccountChanged', () => this.refresh());
    document.addEventListener('walletChainChanged', () => this.refresh());
  }

  toggle(anchorEl) {
    if (this.isOpen) this.hide();
    else this.show(anchorEl);
  }

  async show(anchorEl) {
    const address = this.walletManager?.getAddress?.();
    if (!address) return;

    this._ensureContainer();
    this._containerEl.innerHTML = this._renderHTML({ address, balanceText: 'Loading…' });
    this.popupEl = this._containerEl.querySelector('.wallet-popup');
    this.isOpen = true;

    this._position(anchorEl);

    // Load balance (best-effort)
    try {
      const provider = this.walletManager?.getProvider?.();
      if (provider && provider.getBalance && window.ethers) {
        const bal = await provider.getBalance(address);
        const formatted = window.ethers.utils.formatEther(bal);
        const display = this._formatBalance(formatted);
        this._setBalance(`${display} ${this._nativeSymbol()}`);
      } else {
        this._setBalance(`-- ${this._nativeSymbol()}`);
      }
    } catch {
      this._setBalance(`-- ${this._nativeSymbol()}`);
    }
  }

  hide() {
    if (!this._containerEl) return;
    this._containerEl.innerHTML = '';
    this.popupEl = null;
    this.isOpen = false;
  }

  refresh() {
    if (!this.isOpen) return;
    // Re-render quickly without anchor re-position unless we have an anchor ref later.
    this.hide();
  }

  _ensureContainer() {
    this._containerEl = document.getElementById('wallet-popup-container');
    if (!this._containerEl) {
      this._containerEl = document.createElement('div');
      this._containerEl.id = 'wallet-popup-container';
      document.body.appendChild(this._containerEl);
    }
  }

  _attachGlobalClickListener() {
    document.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      const target = e.target;
      if (!(target instanceof Element)) {
        this.hide();
        return;
      }
      if (!target.closest('.wallet-popup') && !target.closest('#connect-wallet-btn')) {
        this.hide();
      }
    });
  }

  _attachContainerHandlers() {
    if (!this._containerEl) return;

    // Event delegation on container - handles all popup interactions
    this._containerEl.addEventListener('click', async (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      // Close button
      if (target.closest('[data-wallet-close]')) {
        e.stopPropagation();
        this.hide();
        return;
      }

      // Copy button or address text
      const copyBtn = target.closest('[data-wallet-copy]');
      const addressText = target.closest('.address-text');
      if (copyBtn || addressText) {
        e.stopPropagation();
        const addr = copyBtn?.getAttribute('data-address') || 
                     this._containerEl.querySelector('[data-wallet-copy]')?.getAttribute('data-address') ||
                     this.walletManager?.getAddress?.();
        if (addr) {
          await this._copy(addr);
        }
        return;
      }

      // Disconnect button
      if (target.closest('[data-wallet-disconnect]')) {
        e.stopPropagation();
        await this.walletManager?.disconnect?.();
        this.hide();
        return;
      }

      // Prevent closing when clicking inside popup
      if (target.closest('.wallet-popup')) {
        e.stopPropagation();
      }
    });
  }

  _position(anchorEl) {
    if (!this.popupEl || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupRect = this.popupEl.getBoundingClientRect();

    let top = rect.bottom + 8;
    let left = rect.right - popupRect.width;

    if (left < 8) left = 8;
    if (top + popupRect.height > window.innerHeight - 8) {
      top = rect.top - popupRect.height - 8;
    }

    this.popupEl.style.top = `${top}px`;
    this.popupEl.style.left = `${left}px`;
  }


  _renderHTML({ address, balanceText }) {
    const short = this._shortAddress(address);
    return `
      <div class="wallet-popup" role="dialog" aria-label="Wallet">
        <div class="wallet-popup-content">
          <button class="wallet-popup-close" type="button" title="Close" data-wallet-close>×</button>

          <div class="wallet-balance">
            <div class="balance-label">${this._nativeSymbol()} Balance</div>
            <div class="balance-value" data-wallet-balance>${balanceText}</div>
          </div>

          <div class="wallet-address">
            <span class="address-text">${short}</span>
            <button class="copy-icon-button" type="button" title="Copy address" data-wallet-copy data-address="${address}">
              Copy
            </button>
          </div>

          <div class="wallet-actions">
            <button class="disconnect-button" type="button" data-wallet-disconnect>Disconnect</button>
          </div>
        </div>
      </div>
    `;
  }

  _setBalance(text) {
    const el = this._containerEl?.querySelector('[data-wallet-balance]');
    if (el) el.textContent = text;
  }

  async _copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      this._showCopyFeedback();
      window.toastManager?.success?.('Address copied to clipboard', { timeoutMs: 2000 });
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        this._showCopyFeedback();
        window.toastManager?.success?.('Address copied to clipboard', { timeoutMs: 2000 });
      } catch {
        window.toastManager?.error?.('Failed to copy address');
      }
      document.body.removeChild(ta);
    }
  }

  _showCopyFeedback() {
    const copyButton = this.popupEl?.querySelector('.copy-icon-button');
    const addressText = this.popupEl?.querySelector('.address-text');
    
    if (copyButton) {
      copyButton.classList.add('success');
      setTimeout(() => {
        copyButton.classList.remove('success');
      }, 1500);
    }
    
    if (addressText) {
      addressText.classList.add('copied');
      setTimeout(() => {
        addressText.classList.remove('copied');
      }, 500);
    }
  }

  _shortAddress(addr) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  _formatBalance(str) {
    const n = Number(str);
    if (!Number.isFinite(n)) return str;
    if (n === 0) return '0';
    if (n < 0.0001) return '<0.0001';
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  _nativeSymbol() {
    return this.networkManager?.networkSymbol?.() || (this.networkManager ? 'MATIC' : 'MATIC');
  }
}


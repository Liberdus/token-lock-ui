import { CONFIG } from '../config.js';

export class Header {
  constructor() {
    this.connectWalletBtn = null;
    this._connectBtnText = 'Connect Wallet';
    this._walletPicker = null;
  }

  load() {
    this.connectWalletBtn = document.getElementById('connect-wallet-btn');
    if (!this.connectWalletBtn) return;

    this._connectBtnText = this.connectWalletBtn.textContent?.trim() || this._connectBtnText;

    this.connectWalletBtn.addEventListener('click', () => this.onConnectWalletClick());

    document.addEventListener('walletConnected', () => this.updateConnectButtonStatus());
    document.addEventListener('walletDisconnected', () => this.updateConnectButtonStatus());
    document.addEventListener('walletAccountChanged', () => this.updateConnectButtonStatus());
    document.addEventListener('walletChainChanged', () => this.updateConnectButtonStatus());
    document.addEventListener('walletProvidersChanged', () => this.updateConnectButtonStatus());
    document.addEventListener('click', (event) => this._onDocumentClick(event));

    this.updateConnectButtonStatus();
  }

  async onConnectWalletClick() {
    const btn = this.connectWalletBtn;
    if (!btn) return;

    const walletManager = window.walletManager;
    const networkManager = window.networkManager;
    const walletPopup = window.walletPopup;
    const networkName = CONFIG?.NETWORK?.NAME || 'required network';

    if (walletManager?.isConnecting) {
      return;
    }

    if (walletManager?.isConnected?.() && networkManager?.isOnRequiredNetwork?.()) {
      walletPopup?.toggle?.(btn);
      return;
    }

    if (walletManager?.isConnected?.() && !networkManager?.isOnRequiredNetwork?.()) {
      this.renderConnectButton({ text: `Connecting to ${networkName}...`, disabled: true });
      try {
        await networkManager.ensureRequiredNetwork();
      } catch (e) {
        window.alert(`Please connect to ${networkName} in your wallet.`);
      } finally {
        this.updateConnectButtonStatus();
      }
      return;
    }

    this.renderConnectButton({ text: 'Connecting...', disabled: true });
    try {
      await walletManager?.connectWallet?.();
      if (walletManager?.isConnected?.() && !networkManager?.isOnRequiredNetwork?.()) {
        this.renderConnectButton({ text: `Connecting to ${networkName}...`, disabled: true });
        await networkManager.ensureRequiredNetwork();
      }
    } catch (e) {
      if (e?.code === 'WALLET_SELECTION_REQUIRED') {
        try {
          const walletId = await this._pickWallet(e.wallets || []);
          this.renderConnectButton({ text: 'Connecting...', disabled: true });
          await walletManager?.connectWallet?.({ walletId });
          if (walletManager?.isConnected?.() && !networkManager?.isOnRequiredNetwork?.()) {
            this.renderConnectButton({ text: `Connecting to ${networkName}...`, disabled: true });
            await networkManager.ensureRequiredNetwork();
          }
        } catch (selectionError) {
          if (selectionError?.message !== 'Wallet selection cancelled.') {
            window.alert(selectionError?.message || 'Failed to connect wallet');
          }
        }
        return;
      }

      const fallbackMessage = walletManager?.walletsLoaded && !walletManager?.hasAvailableWallets?.()
        ? 'A compatible browser wallet is required for this app.'
        : 'Failed to connect wallet';
      window.alert(e?.message || fallbackMessage);
    } finally {
      this._closeWalletPicker(false);
      this.updateConnectButtonStatus();
    }
  }

  _pickWallet(wallets = []) {
    this._closeWalletPicker(false);

    return new Promise((resolve, reject) => {
      const navSection = this.connectWalletBtn?.closest('.nav-section');
      if (!navSection || !wallets.length) {
        reject(new Error('No compatible browser wallet was detected.'));
        return;
      }

      const menu = document.createElement('div');
      menu.className = 'wallet-picker-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Choose a wallet');

      const title = document.createElement('div');
      title.className = 'wallet-picker-menu__title';
      title.textContent = 'Choose a wallet';
      menu.appendChild(title);

      for (const wallet of wallets) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'wallet-picker-menu__item';
        item.setAttribute('role', 'menuitem');

        const name = wallet?.info?.name || 'Wallet';
        const initials = name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((word) => word[0].toUpperCase())
          .join('') || 'W';

        const icon = document.createElement('span');
        icon.className = 'wallet-picker-menu__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = initials;

        const iconUrl = wallet?.info?.icon || '';
        if (iconUrl) {
          const image = document.createElement('img');
          image.alt = '';
          image.onload = () => icon.replaceChildren(image);
          image.src = iconUrl;
          if (image.complete && image.naturalWidth) image.onload();
        }

        const label = document.createElement('span');
        label.className = 'wallet-picker-menu__label';
        label.textContent = name;

        item.append(icon, label);
        item.addEventListener('click', () => {
          this._closeWalletPicker(false);
          resolve(wallet.id);
        });
        menu.appendChild(item);
      }

      navSection.classList.add('has-wallet-picker');
      navSection.appendChild(menu);
      this._walletPicker = { menu, reject };
    });
  }

  _closeWalletPicker(cancelled = true) {
    if (!this._walletPicker) return;

    if (cancelled) {
      this._walletPicker.reject(new Error('Wallet selection cancelled.'));
    }

    this._walletPicker.menu.remove();
    this.connectWalletBtn?.closest('.nav-section')?.classList.remove('has-wallet-picker');
    this._walletPicker = null;
  }

  _onDocumentClick(event) {
    if (!this._walletPicker) return;
    const navSection = this.connectWalletBtn?.closest('.nav-section');
    if (navSection?.contains(event.target)) return;
    this._closeWalletPicker();
    this.updateConnectButtonStatus();
  }

  updateConnectButtonStatus() {
    const walletManager = window.walletManager;
    const networkManager = window.networkManager;

    if (!this.connectWalletBtn) return;

    if (walletManager?.isConnecting) {
      this.renderConnectButton({ text: 'Connecting...', disabled: true });
      return;
    }

    const isConnected = !!walletManager?.isConnected?.();
    const address = walletManager?.getAddress?.();
    const onRequiredNetwork = !!networkManager?.isOnRequiredNetwork?.();

    if (!isConnected) {
      const hasWallets = !!walletManager?.hasAvailableWallets?.();
      const walletsLoaded = !!walletManager?.walletsLoaded;
      this.renderConnectButton({
        text: walletsLoaded && !hasWallets ? 'Install Wallet' : 'Connect Wallet',
        disabled: false,
      });
      return;
    }

    if (!onRequiredNetwork) {
      this.renderConnectButton({ text: `Connect to ${CONFIG?.NETWORK?.NAME || 'Network'}`, disabled: false });
      return;
    }

    const short = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connected';
    this.renderConnectButton({ text: short, disabled: false, connected: true });
  }

  renderConnectButton({ text, disabled = false, connected = false } = {}) {
    const btn = this.connectWalletBtn;
    if (!btn) return;

    btn.textContent = text || this._connectBtnText;
    btn.disabled = !!disabled;
    btn.classList.toggle('is-connected', !!connected);
  }
}

import { CONFIG } from '../config.js';

export class Header {
  constructor() {
    this.connectWalletBtn = null;
    this._connectBtnText = 'Connect Wallet';
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
      await walletManager?.connectPrimaryWallet?.();
      if (walletManager?.isConnected?.() && !networkManager?.isOnRequiredNetwork?.()) {
        this.renderConnectButton({ text: `Connecting to ${networkName}...`, disabled: true });
        await networkManager.ensureRequiredNetwork();
      }
    } catch (e) {
      const fallbackMessage = walletManager?.walletsLoaded && !walletManager?.hasAvailableWallets?.()
        ? 'A compatible browser wallet is required for this app.'
        : 'Failed to connect wallet';
      window.alert(e?.message || fallbackMessage);
    } finally {
      this.updateConnectButtonStatus();
    }
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

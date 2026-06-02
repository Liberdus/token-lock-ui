import { createWalletCore } from '../../vendor/liberdus-wallet-module/index.js';

const DEFAULT_WALLET_SESSION_KEY = 'liberdus_token_ui_wallet_session';
const LEGACY_WALLET_STORAGE_KEY = 'liberdus_token_ui_wallet_connection';
const WALLET_SELECTION_REQUIRED = 'WALLET_SELECTION_REQUIRED';

function normalizeChainId(rawChainId) {
  if (typeof rawChainId === 'number' && Number.isFinite(rawChainId)) {
    return Number(rawChainId);
  }
  if (typeof rawChainId === 'string' && rawChainId.trim()) {
    return rawChainId.startsWith('0x')
      ? Number.parseInt(rawChainId, 16)
      : Number(rawChainId);
  }
  return null;
}

function cloneWalletDescriptor(wallet) {
  return {
    id: wallet?.id || '',
    source: wallet?.source || '',
    info: {
      name: wallet?.info?.name || '',
      rdns: wallet?.info?.rdns || '',
      icon: wallet?.info?.icon || '',
      uuid: wallet?.info?.uuid || '',
    },
  };
}

export class WalletManager {
  constructor({ storageKey = DEFAULT_WALLET_SESSION_KEY } = {}) {
    this.storageKey = storageKey;

    this.walletCore = createWalletCore({
      storage: this._getStorage(),
      walletSessionKey: this.storageKey,
    });

    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    this.walletType = null;
    this.rawProvider = null;

    this.selectedWalletId = null;
    this.selectedWalletName = null;
    this.selectedWalletRdns = null;
    this.selectedWalletIcon = null;

    this.availableWallets = [];
    this.walletsLoaded = false;
    this.isConnecting = false;
    this._connectionPromise = null;
    this._unsubscribeWalletCore = null;

    this.listeners = new Set();
  }

  load() {
    if (this._unsubscribeWalletCore) return;
    this._unsubscribeWalletCore = this.walletCore.subscribe((event, data) => {
      this._handleWalletCoreEvent(event, data);
    });
  }

  async init() {
    await this.refreshAvailableWallets();
    await this.checkPreviousConnection();
    this._clearLegacyConnectionInfo();
  }

  isConnected() {
    return !!(this.address && this.provider && this.signer);
  }

  isWalletConnected() {
    return this.isConnected();
  }

  hasAvailableWallets() {
    return this.availableWallets.length > 0;
  }

  getAvailableWallets() {
    return this.availableWallets.map((wallet) => cloneWalletDescriptor(wallet));
  }

  getSelectedWalletName() {
    return this.selectedWalletName;
  }

  getAccount() {
    return this.address;
  }

  getAddress() {
    return this.address;
  }

  getChainId() {
    return this.chainId;
  }

  getProvider() {
    return this.provider;
  }

  getSigner() {
    return this.signer;
  }

  getEip1193Provider() {
    return this.rawProvider || this.walletCore.getEip1193Provider?.() || null;
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async refreshAvailableWallets({ waitMs } = {}) {
    const wallets = typeof waitMs === 'number'
      ? await this.walletCore.discoverWallets(waitMs)
      : await this.walletCore.discoverWallets();
    this.availableWallets = Array.isArray(wallets) ? wallets.map((wallet) => cloneWalletDescriptor(wallet)) : [];
    this.walletsLoaded = true;
    return this.getAvailableWallets();
  }

  async connectMetaMask() {
    return this.connectPrimaryWallet();
  }

  async connectPrimaryWallet() {
    if (this._connectionPromise) return this._connectionPromise;
    this._connectionPromise = this._performConnect(null, { requireSelection: false });
    try {
      return await this._connectionPromise;
    } finally {
      this._connectionPromise = null;
    }
  }

  async connectWallet({ walletId } = {}) {
    if (this._connectionPromise) return this._connectionPromise;
    this._connectionPromise = this._performConnect(walletId, { requireSelection: true });
    try {
      return await this._connectionPromise;
    } finally {
      this._connectionPromise = null;
    }
  }

  async _performConnect(walletId = null, { requireSelection = false } = {}) {
    if (!window.ethers) {
      throw new Error('Ethers.js not loaded');
    }
    if (this.isConnected()) {
      return {
        success: true,
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
        walletId: this.selectedWalletId,
      };
    }

    this.isConnecting = true;
    try {
      const wallets = await this.refreshAvailableWallets();
      if (!wallets.length) {
        throw new Error('No compatible browser wallet was detected.');
      }

      const selectedWallet = await this._selectWalletForConnect(wallets, walletId, { requireSelection });

      if (!selectedWallet?.id) {
        throw new Error('The selected wallet is no longer available. Refresh the page and try again.');
      }

      await this.walletCore.connect({ walletId: selectedWallet.id });
      this._applyState(this.walletCore.getState());

      return {
        success: true,
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
        walletId: this.selectedWalletId,
      };
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect() {
    await this.walletCore.disconnect();
  }

  async checkPreviousConnection() {
    const hadConnection = this.isConnected();
    const state = await this.walletCore.sync();
    this._applyState(state);

    if (this.isConnected()) {
      this._notify('connected', {
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
        walletId: this.selectedWalletId,
        walletName: this.selectedWalletName,
        restored: true,
      });
      return true;
    }

    if (hadConnection) {
      this._notify('disconnected', {});
    }
    return false;
  }

  _handleWalletCoreEvent(event, data) {
    if (event === 'providersChanged') {
      this.availableWallets = Array.isArray(data) ? data.map((wallet) => cloneWalletDescriptor(wallet)) : [];
      this.walletsLoaded = true;
      this._notify('providersChanged', { wallets: this.getAvailableWallets() });
      return;
    }

    if (event === 'connected') {
      this._applyState(this.walletCore.getState());
      this._clearLegacyConnectionInfo();
      this._notify('connected', {
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
        walletId: this.selectedWalletId,
        walletName: this.selectedWalletName,
        wallet: data?.wallet || null,
      });
      return;
    }

    if (event === 'disconnected') {
      this._clearConnectionState();
      this._clearLegacyConnectionInfo();
      this._notify('disconnected', {});
      return;
    }

    if (event === 'accountChanged') {
      const previousAddress = this.address;
      this._applyState(this.walletCore.getState());
      if (!this.address) {
        if (previousAddress) {
          this._notify('disconnected', {});
        }
        return;
      }
      this._notify('accountChanged', { address: this.address, chainId: this.chainId });
      return;
    }

    if (event === 'chainChanged') {
      this._applyState(this.walletCore.getState());
      this._notify('chainChanged', { address: this.address, chainId: this.chainId });
    }
  }

  _applyState(state = {}) {
    this.rawProvider = state.injectedProvider || this.walletCore.getEip1193Provider?.() || null;
    this.address = this._formatAddress(state.account);
    this.chainId = normalizeChainId(state.chainId);
    this.selectedWalletId = state.selectedWalletId || state.sessionWalletId || null;
    this.selectedWalletName = state.selectedWalletName || null;
    this.selectedWalletRdns = state.selectedWalletRdns || null;
    this.selectedWalletIcon = state.selectedWalletIcon || null;
    this.walletType = this.selectedWalletRdns || this.selectedWalletName || (this.selectedWalletId ? 'injected' : null);

    if (this.rawProvider && window.ethers?.providers?.Web3Provider) {
      this.provider = new window.ethers.providers.Web3Provider(this.rawProvider, 'any');
      try {
        this.signer = this.provider.getSigner();
      } catch {
        this.signer = null;
      }
      return;
    }

    this.provider = null;
    this.signer = null;
  }

  _clearConnectionState() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    this.walletType = null;
    this.rawProvider = null;
    this.selectedWalletId = null;
    this.selectedWalletName = null;
    this.selectedWalletRdns = null;
    this.selectedWalletIcon = null;
  }

  _selectPrimaryWallet(wallets = []) {
    const currentState = this.walletCore.getState?.() || {};
    const sessionWalletId = currentState.sessionWalletId || this.selectedWalletId || null;
    if (sessionWalletId) {
      const persistedWallet = wallets.find((wallet) => wallet.id === sessionWalletId);
      if (persistedWallet) return persistedWallet;
    }

    const metamaskWallet = wallets.find((wallet) => {
      const name = String(wallet?.info?.name || '');
      const rdns = String(wallet?.info?.rdns || '').toLowerCase();
      return rdns === 'io.metamask' || /metamask/i.test(name);
    });

    return metamaskWallet || wallets[0] || null;
  }

  async _selectWalletForConnect(wallets = [], walletId = null, { requireSelection = false } = {}) {
    if (walletId) {
      return wallets.find((wallet) => wallet.id === walletId) || null;
    }

    if (!requireSelection) {
      return this._selectPrimaryWallet(wallets);
    }

    if (wallets.length === 1) {
      return wallets[0];
    }

    try {
      await this.walletCore.sync();
    } catch {
      // A stale persisted session should not block a fresh wallet choice.
    }

    const currentState = this.walletCore.getState?.() || {};
    const sessionWalletId = currentState.sessionWalletId || this.selectedWalletId || null;
    if (sessionWalletId) {
      const persistedWallet = wallets.find((wallet) => wallet.id === sessionWalletId);
      if (persistedWallet) return persistedWallet;
    }

    const error = new Error('Wallet selection required.');
    error.code = WALLET_SELECTION_REQUIRED;
    error.wallets = this.getAvailableWallets();
    throw error;
  }

  _formatAddress(address) {
    if (!address) return null;
    const value = String(address).trim();
    if (!value) return null;
    try {
      return window.ethers?.utils?.getAddress
        ? window.ethers.utils.getAddress(value)
        : value;
    } catch {
      return value;
    }
  }

  _getStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  _clearLegacyConnectionInfo() {
    try {
      localStorage.removeItem(LEGACY_WALLET_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  _notify(event, data) {
    this.listeners.forEach((cb) => {
      try {
        cb(event, data);
      } catch {
        // ignore
      }
    });

    const eventNameMap = {
      connected: 'walletConnected',
      disconnected: 'walletDisconnected',
      accountChanged: 'walletAccountChanged',
      chainChanged: 'walletChainChanged',
      providersChanged: 'walletProvidersChanged',
    };
    const domName = eventNameMap[event] || `wallet${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    document.dispatchEvent(new CustomEvent(domName, { detail: { event, data } }));
  }
}

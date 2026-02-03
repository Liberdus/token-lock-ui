import { MetaMaskConnector } from './metamask-connector.js';

/**
 * WalletManager (Phase 2)
 * - MetaMask-only connection
 * - Restores previous connection (best-effort)
 * - Dispatches DOM events:
 *   - walletConnected, walletDisconnected, walletAccountChanged, walletChainChanged
 */
export class WalletManager {
  constructor({ storageKey = 'liberdus_token_ui_wallet_connection' } = {}) {
    this.storageKey = storageKey;

    this.connector = new MetaMaskConnector();
    this.provider = null; // ethers.providers.Web3Provider
    this.signer = null; // ethers.Signer
    this.address = null;
    this.chainId = null; // number
    this.walletType = null; // 'metamask'

    this.isConnecting = false;
    this._connectionPromise = null;

    this.listeners = new Set();
  }

  load() {
    this.connector.load();

    // Wire connector callbacks → WalletManager events
    this.connector.onAccountsChanged = (accounts) => this._handleAccountsChanged(accounts);
    this.connector.onChainChanged = (chainId) => this._handleChainChanged(chainId);
    this.connector.onDisconnected = () => this._handleDisconnected();
  }

  async init() {
    // Best-effort restore before user clicks.
    await this.checkPreviousConnection();
  }

  isConnected() {
    return !!(this.address && this.provider && this.signer);
  }

  isWalletConnected() {
    return this.isConnected();
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

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async connectMetaMask() {
    if (this._connectionPromise) return this._connectionPromise;
    this._connectionPromise = this._performConnectMetaMask();
    try {
      return await this._connectionPromise;
    } finally {
      this._connectionPromise = null;
    }
  }

  async _performConnectMetaMask() {
    if (!this.connector.isAvailable()) {
      throw new Error('MetaMask not installed');
    }
    if (this.isConnected()) {
      return { success: true, address: this.address, chainId: this.chainId, walletType: this.walletType };
    }

    this.isConnecting = true;
    try {
      const result = await this.connector.connect();

      this.provider = result.provider;
      this.signer = result.signer;
      this.address = result.account;
      this.chainId = result.chainId;
      this.walletType = 'metamask';

      this._storeConnectionInfo();

      this._notify('connected', {
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
      });

      return { success: true, address: this.address, chainId: this.chainId, walletType: this.walletType };
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect() {
    await this.connector.disconnect();

    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    this.walletType = null;

    this._clearConnectionInfo();
    this._notify('disconnected', {});
  }

  async checkPreviousConnection() {
    if (!this.connector.isAvailable()) return false;

    // If we stored a previous connection, verify MetaMask still exposes the same account.
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
    } catch {
      stored = null;
    }
    if (!stored?.address) return false;

    try {
      const accounts = await this.connector.getAccounts(); // does not prompt
      if (!accounts || accounts.length === 0) {
        this._clearConnectionInfo();
        return false;
      }

      const addr = accounts[0];
      if (addr.toLowerCase() !== String(stored.address).toLowerCase()) {
        // Different account than last time; still restore with the current one.
      }

      // Create provider/signer without prompting
      if (!window.ethers) {
        return false;
      }

      this.provider = new window.ethers.providers.Web3Provider(window.ethereum);
      this.signer = this.provider.getSigner();
      this.address = addr;

      const network = await this.provider.getNetwork();
      this.chainId = Number(network.chainId);
      this.walletType = 'metamask';

      // Keep connector state in sync and ensure events are wired.
      this.connector.account = this.address;
      this.connector.chainId = this.chainId;
      this.connector.provider = this.provider;
      this.connector.signer = this.signer;
      this.connector.isConnected = true;
      this.connector.attachEventListeners();

      this._notify('connected', {
        address: this.address,
        chainId: this.chainId,
        walletType: this.walletType,
        restored: true,
      });

      return true;
    } catch (e) {
      // If anything goes wrong, clear stored state so we don't loop.
      this._clearConnectionInfo();
      return false;
    }
  }

  _handleAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      this.disconnect().catch(() => {});
      return;
    }
    this.address = accounts[0];
    this._storeConnectionInfo();
    this._notify('accountChanged', { address: this.address, chainId: this.chainId });
  }

  _handleChainChanged(chainId) {
    this.chainId = Number(chainId);
    this._storeConnectionInfo();
    this._notify('chainChanged', { address: this.address, chainId: this.chainId });
  }

  _handleDisconnected() {
    this.disconnect().catch(() => {});
  }

  _notify(event, data) {
    // Listener callbacks
    this.listeners.forEach((cb) => {
      try {
        cb(event, data);
      } catch (e) {
        // ignore
      }
    });

    // DOM events (for simple integration)
    const eventNameMap = {
      connected: 'walletConnected',
      disconnected: 'walletDisconnected',
      accountChanged: 'walletAccountChanged',
      chainChanged: 'walletChainChanged',
    };
    const domName = eventNameMap[event] || `wallet${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    document.dispatchEvent(new CustomEvent(domName, { detail: { event, data } }));
  }

  _storeConnectionInfo() {
    if (!this.address) return;
    const payload = {
      walletType: this.walletType || 'metamask',
      address: this.address,
      chainId: this.chainId,
      timestamp: Date.now(),
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  _clearConnectionInfo() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
  }
}


/**
 * MetaMaskConnector (Phase 2)
 * - Low-level MetaMask interactions (EIP-1193)
 * - Creates an ethers Web3Provider when connected
 *
 * This stays intentionally small; higher-level app logic lives in WalletManager.
 */

export class MetaMaskConnector {
  constructor() {
    this.account = null;
    this.chainId = null; // number
    this.provider = null; // ethers.providers.Web3Provider
    this.signer = null; // ethers.Signer
    this.isConnected = false;

    this._boundAccountsChanged = null;
    this._boundChainChanged = null;
    this._boundDisconnect = null;

    // Optional callbacks (set by WalletManager)
    this.onAccountsChanged = null;
    this.onChainChanged = null;
    this.onDisconnected = null;
  }

  isAvailable() {
    return typeof window !== 'undefined' && !!window.ethereum && !!window.ethereum.isMetaMask;
  }

  load() {
    // No-op for now (kept for pattern consistency)
  }

  async connect() {
    if (!this.isAvailable()) {
      throw new Error('MetaMask is not installed');
    }
    if (!window.ethers) {
      throw new Error('Ethers.js not loaded');
    }

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }

    this.account = accounts[0];
    this.chainId = await this._readChainId();

    this.provider = new window.ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.isConnected = true;

    this.attachEventListeners();

    return {
      account: this.account,
      chainId: this.chainId,
      provider: this.provider,
      signer: this.signer,
    };
  }

  /**
   * Attach MetaMask event listeners without prompting the user.
   * Useful when restoring a previous connection via eth_accounts.
   */
  attachEventListeners() {
    this._setupEventListeners();
  }

  async disconnect() {
    // MetaMask does not support programmatic disconnection.
    // We just clear local app state and listeners.
    this.isConnected = false;
    this.account = null;
    this.chainId = null;
    this.provider = null;
    this.signer = null;

    this._removeEventListeners();
  }

  async getAccounts() {
    if (!window.ethereum) return [];
    return await window.ethereum.request({ method: 'eth_accounts' });
  }

  async _readChainId() {
    if (!window.ethereum) return null;
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    return this._hexToNumber(chainIdHex);
  }

  async switchNetwork(chainId) {
    if (!window.ethereum) throw new Error('No wallet provider available');
    const hexChainId = this._numberToHex(chainId);
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  }

  async addNetwork(networkConfig) {
    if (!window.ethereum) throw new Error('MetaMask is not installed');
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [networkConfig],
    });
  }

  getAccount() {
    return this.account;
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

  _setupEventListeners() {
    if (!window.ethereum || !window.ethereum.on) return;

    this._removeEventListeners();

    this._boundAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        // user disconnected in MetaMask UI
        this.isConnected = false;
        this.account = null;
        if (typeof this.onDisconnected === 'function') this.onDisconnected();
        return;
      }
      this.account = accounts[0];
      this.isConnected = true;
      if (typeof this.onAccountsChanged === 'function') this.onAccountsChanged(accounts);
    };

    this._boundChainChanged = (chainIdHex) => {
      this.chainId = this._hexToNumber(chainIdHex);
      if (typeof this.onChainChanged === 'function') this.onChainChanged(this.chainId);
    };

    this._boundDisconnect = () => {
      this.isConnected = false;
      this.account = null;
      if (typeof this.onDisconnected === 'function') this.onDisconnected();
    };

    window.ethereum.on('accountsChanged', this._boundAccountsChanged);
    window.ethereum.on('chainChanged', this._boundChainChanged);
    window.ethereum.on('disconnect', this._boundDisconnect);
  }

  _removeEventListeners() {
    if (!window.ethereum || !window.ethereum.removeListener) return;
    if (this._boundAccountsChanged) window.ethereum.removeListener('accountsChanged', this._boundAccountsChanged);
    if (this._boundChainChanged) window.ethereum.removeListener('chainChanged', this._boundChainChanged);
    if (this._boundDisconnect) window.ethereum.removeListener('disconnect', this._boundDisconnect);

    this._boundAccountsChanged = null;
    this._boundChainChanged = null;
    this._boundDisconnect = null;
  }

  _hexToNumber(hex) {
    if (!hex) return null;
    if (typeof hex === 'number') return hex;
    try {
      return parseInt(hex, 16);
    } catch {
      return null;
    }
  }

  _numberToHex(num) {
    return '0x' + Number(num).toString(16);
  }
}


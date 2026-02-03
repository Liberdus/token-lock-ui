import { CONFIG } from '../config.js';
import { peekReadOnlyProvider } from '../utils/read-only-provider.js';

/**
 * NetworkManager (Phase 2)
 * Polygon Amoy-only:
 * - Read-only mode uses CONFIG.NETWORK.RPC_URL
 * - Tx-enabled mode requires MetaMask connected AND chainId === CONFIG.NETWORK.CHAIN_ID
 */
export class NetworkManager {
  constructor({ walletManager } = {}) {
    this.walletManager = walletManager || null;
    this.requiredChainId = CONFIG.NETWORK.CHAIN_ID;
    this.requiredChainHex = this._toHexChainId(this.requiredChainId);
  }

  load() {
    // Subscribe to wallet events so UI can stay in sync.
    document.addEventListener('walletConnected', () => this.updateUIState());
    document.addEventListener('walletDisconnected', () => this.updateUIState());
    document.addEventListener('walletAccountChanged', () => this.updateUIState());
    document.addEventListener('walletChainChanged', () => this.updateUIState());

    // Initial UI state
    this.updateUIState();
  }

  isOnRequiredNetwork(chainId = null) {
    const cid = chainId ?? this.walletManager?.getChainId?.() ?? null;
    return Number(cid) === Number(this.requiredChainId);
  }

  isTxEnabled() {
    const connected = !!this.walletManager?.isConnected?.();
    return connected && this.isOnRequiredNetwork();
  }

  getReadOnlyProvider() {
    // Reuse the singleton read-only provider (do not create new providers here).
    return peekReadOnlyProvider() || null;
  }

  getTxProvider() {
    return this.walletManager?.getProvider?.() || null;
  }

  async ensureRequiredNetwork() {
    if (!window.ethereum) throw new Error('MetaMask not available');
    // Try switching; if missing, add then switch.
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.requiredChainHex }],
      });
      return true;
    } catch (error) {
      if (error && error.code === 4902) {
        await this.addRequiredNetwork();
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: this.requiredChainHex }],
        });
        return true;
      }
      throw error;
    }
  }

  async addRequiredNetwork() {
    const networkConfig = this.buildNetworkConfig();
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [networkConfig],
    });
  }

  buildNetworkConfig() {
    return {
      chainId: this.requiredChainHex,
      chainName: CONFIG.NETWORK.NAME,
      rpcUrls: [CONFIG.NETWORK.RPC_URL, ...(CONFIG.NETWORK.FALLBACK_RPCS || [])].filter(Boolean),
      nativeCurrency: CONFIG.NETWORK.NATIVE_CURRENCY,
      blockExplorerUrls: [CONFIG.NETWORK.BLOCK_EXPLORER].filter(Boolean),
    };
  }

  networkSymbol() {
    return CONFIG.NETWORK?.NATIVE_CURRENCY?.symbol || 'POL';
  }

  updateUIState() {
    this.updateTxGatedControls();
  }

  /**
   * Simple gating: any element marked data-requires-tx="true"
   * will be disabled unless tx-enabled.
   */
  updateTxGatedControls() {
    const txEnabled = this.isTxEnabled();
    const gated = Array.from(document.querySelectorAll('[data-requires-tx="true"]'));
    gated.forEach((el) => {
      // Allow permanent disable for placeholders (Phase 1/5/6 UI)
      if (el.getAttribute('data-always-disabled') === 'true') return;

      if ('disabled' in el) {
        el.disabled = !txEnabled;
      }
      el.classList.toggle('is-disabled', !txEnabled);
    });
  }

  _toHexChainId(chainId) {
    return '0x' + Number(chainId).toString(16);
  }
}

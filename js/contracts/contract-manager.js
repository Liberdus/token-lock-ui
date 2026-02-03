import { CONFIG } from '../config.js';
import { getReadOnlyProvider } from '../utils/read-only-provider.js';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export class ContractManager {
  constructor({ walletManager, networkManager } = {}) {
    this.walletManager = walletManager || null;
    this.networkManager = networkManager || null;

    this.readOnlyProvider = null;
    this.provider = null;
    this.signer = null;

    this.abi = null;
    this.contractRead = null;
    this.contractWrite = null;

    this._loadPromise = null;
  }

  load() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._load().catch((error) => {
      this._loadPromise = null;
      throw error;
    });
    return this._loadPromise;
  }

  async _load() {
    if (!window.ethers) {
      throw new Error('Ethers.js not loaded');
    }

    this.readOnlyProvider = await getReadOnlyProvider();
    this.abi = await this._fetchAbi();

    this.updateConnections();

    document.addEventListener('walletConnected', () => this.updateConnections());
    document.addEventListener('walletDisconnected', () => this.updateConnections());
    document.addEventListener('walletAccountChanged', () => this.updateConnections());
    document.addEventListener('walletChainChanged', () => this.updateConnections());
  }

  async _fetchAbi() {
    const response = await fetch('./abi.json', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load ABI (abi.json): ${response.status}`);
    }
    const json = await response.json();
    const abi = Array.isArray(json) ? json : json?.abi;
    if (!Array.isArray(abi)) {
      throw new Error('Invalid ABI format: expected { "abi": [...] }');
    }
    return abi;
  }

  updateConnections() {
    const txEnabled = !!this.networkManager?.isTxEnabled?.();

    if (txEnabled) {
      this.provider = this.walletManager?.getProvider?.() || this.readOnlyProvider;
      this.signer = this.walletManager?.getSigner?.() || null;
    } else {
      this.provider = this.readOnlyProvider;
      this.signer = null;
    }

    this.contractRead = this._makeContract(this.provider);
    this.contractWrite = this.signer ? this._makeContract(this.signer) : null;

    this._emitUpdatedEvent({ txEnabled, reason: 'connectionsChanged' });
  }

  _emitUpdatedEvent({ txEnabled = !!this.networkManager?.isTxEnabled?.(), reason = 'updated' } = {}) {
    document.dispatchEvent(
      new CustomEvent('contractManagerUpdated', {
        detail: {
          reason,
          txEnabled,
          address: CONFIG.CONTRACT.ADDRESS,
          chainId: CONFIG.NETWORK.CHAIN_ID,
        },
      })
    );
  }

  _makeContract(signerOrProvider) {
    const address = CONFIG.CONTRACT.ADDRESS;
    if (!address) return null;
    if (!this.abi) return null;
    return new window.ethers.Contract(address, this.abi, signerOrProvider);
  }

  _makeErc20Contract(address, signerOrProvider) {
    if (!address) return null;
    return new window.ethers.Contract(address, ERC20_ABI, signerOrProvider);
  }

  getReadContract() {
    return this.contractRead;
  }

  getWriteContract() {
    const txEnabled = !!this.networkManager?.isTxEnabled?.();
    if (!txEnabled || !window.ethereum || !window.ethers) {
      return this.contractWrite;
    }

    const freshProvider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
    const freshSigner = freshProvider.getSigner();
    return this._makeContract(freshSigner);
  }

  getSigner() {
    return this.signer;
  }

  getProvider() {
    return this.provider || this.readOnlyProvider;
  }

  async getNextLockId() {
    const contract = this.getReadContract();
    if (!contract) return null;
    const v = await contract.nextLockId();
    return Number(v.toString());
  }

  async getActiveLockCount() {
    const contract = this.getReadContract();
    if (!contract) return null;
    const v = await contract.getActiveLockCount();
    return Number(v.toString());
  }

  async getActiveLockIds(offset, limit) {
    const contract = this.getReadContract();
    if (!contract) return [];
    const ids = await contract.getActiveLockIds(offset, limit);
    return ids.map((v) => Number(v.toString()));
  }

  async getLock(lockId) {
    const contract = this.getReadContract();
    if (!contract) return null;
    return contract.getLock(lockId);
  }

  async previewWithdrawable(lockId) {
    const contract = this.getReadContract();
    if (!contract) return null;
    const v = await contract.previewWithdrawable(lockId);
    return v;
  }

  async lock({ token, amount, cliffDays, ratePerDay, withdrawAddress }) {
    const contract = this.getWriteContract();
    if (!contract) throw new Error('Wallet not connected');
    return contract.lock(token, amount, cliffDays, ratePerDay, withdrawAddress);
  }

  async unlock({ lockId, unlockTime }) {
    const contract = this.getWriteContract();
    if (!contract) throw new Error('Wallet not connected');
    return contract.unlock(lockId, unlockTime);
  }

  async withdraw({ lockId, amount, percent, to }) {
    const contract = this.getWriteContract();
    if (!contract) throw new Error('Wallet not connected');
    return contract.withdraw(lockId, amount, percent, to);
  }

  async retract({ lockId, to }) {
    const contract = this.getWriteContract();
    if (!contract) throw new Error('Wallet not connected');
    return contract.retract(lockId, to);
  }

  async getTokenMetadata(tokenAddress) {
    const contract = this._makeErc20Contract(tokenAddress, this.readOnlyProvider);
    if (!contract) return null;
    const [symbol, decimals] = await Promise.all([
      contract.symbol().catch(() => ''),
      contract.decimals().catch(() => 18),
    ]);
    return { symbol, decimals: Number(decimals) };
  }

  async getTokenBalance(tokenAddress, owner) {
    const contract = this._makeErc20Contract(tokenAddress, this.readOnlyProvider);
    if (!contract) return null;
    return contract.balanceOf(owner);
  }

  async getTokenAllowance(tokenAddress, owner, spender) {
    const contract = this._makeErc20Contract(tokenAddress, this.readOnlyProvider);
    if (!contract) return null;
    return contract.allowance(owner, spender);
  }

  async approveToken({ token, spender, amount }) {
    const txEnabled = !!this.networkManager?.isTxEnabled?.();
    if (!txEnabled || !window.ethereum || !window.ethers) {
      throw new Error('Wallet not connected');
    }
    const provider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
    const signer = provider.getSigner();
    const contract = this._makeErc20Contract(token, signer);
    return contract.approve(spender, amount);
  }
}

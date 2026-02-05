import { CONFIG } from '../config.js';
import { getReadOnlyProvider } from '../utils/read-only-provider.js';
import { MulticallService } from '../utils/multicall-service.js';

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
    this.multicall = new MulticallService();
    this._multicallInitPromise = null;

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
    await this._initMulticall();

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
    this._initMulticall().catch(() => {});

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

  async getLocksBatch(lockIds = []) {
    const ids = Array.isArray(lockIds) ? lockIds : [];
    if (!ids.length) return [];
    const contract = this.getReadContract();
    if (!contract) return ids.map(() => null);

    if (await this._isMulticallReady()) {
      const calls = ids.map((id) => this.multicall.createCall(contract, 'getLock', [id]));
      const batch = await this.multicall.batchCall(calls, { requireSuccess: false, maxRetries: 1 });
      if (Array.isArray(batch) && batch.length === ids.length) {
        return batch.map((result) => this._decodeMulticallResult(result, contract, 'getLock'));
      }
    }

    return await Promise.all(ids.map(async (id) => this.getLock(id).catch(() => null)));
  }

  async previewWithdrawable(lockId) {
    const contract = this.getReadContract();
    if (!contract) return null;
    const v = await contract.previewWithdrawable(lockId);
    return v;
  }

  async previewWithdrawableBatch(lockIds = []) {
    const ids = Array.isArray(lockIds) ? lockIds : [];
    if (!ids.length) return [];
    const contract = this.getReadContract();
    if (!contract) return ids.map(() => null);

    if (await this._isMulticallReady()) {
      const calls = ids.map((id) => this.multicall.createCall(contract, 'previewWithdrawable', [id]));
      const batch = await this.multicall.batchCall(calls, { requireSuccess: false, maxRetries: 1 });
      if (Array.isArray(batch) && batch.length === ids.length) {
        return batch.map((result) => this._decodeMulticallResult(result, contract, 'previewWithdrawable'));
      }
    }

    return await Promise.all(ids.map(async (id) => this.previewWithdrawable(id).catch(() => null)));
  }

  async lock({
    token,
    amount,
    cliffDays,
    ratePerDay,
    withdrawAddress,
    retractUntilUnlock = false,
  }) {
    const contract = this.getWriteContract();
    if (!contract) throw new Error('Wallet not connected');
    const args = [token, amount, cliffDays, ratePerDay, withdrawAddress];
    const fn = contract?.interface?.getFunction?.('lock');
    if (fn && Array.isArray(fn.inputs) && fn.inputs.length >= 6) {
      args.push(!!retractUntilUnlock);
    }
    return contract.lock(...args);
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

  async getTokenMetadataBatch(tokenAddresses = []) {
    const unique = Array.from(new Set((tokenAddresses || []).map((addr) => String(addr || '').toLowerCase()).filter(Boolean)));
    if (!unique.length) return new Map();

    if (!(await this._isMulticallReady())) {
      const pairs = await Promise.all(unique.map(async (addr) => [addr, await this.getTokenMetadata(addr)]));
      return new Map(pairs.map(([addr, meta]) => [addr, meta || { symbol: '', decimals: 18 }]));
    }

    const iface = new window.ethers.utils.Interface(ERC20_ABI);
    const calls = [];
    unique.forEach((addr) => {
      calls.push({ target: addr, callData: iface.encodeFunctionData('symbol', []) });
      calls.push({ target: addr, callData: iface.encodeFunctionData('decimals', []) });
    });

    const batch = await this.multicall.batchCall(calls, { requireSuccess: false, maxRetries: 1 });
    if (!Array.isArray(batch) || batch.length !== calls.length) {
      const pairs = await Promise.all(unique.map(async (addr) => [addr, await this.getTokenMetadata(addr)]));
      return new Map(pairs.map(([addr, meta]) => [addr, meta || { symbol: '', decimals: 18 }]));
    }

    const out = new Map();
    unique.forEach((addr, i) => {
      const symbolRaw = this._decodeMulticallResult(batch[i * 2], iface, 'symbol');
      const decimalsRaw = this._decodeMulticallResult(batch[i * 2 + 1], iface, 'decimals');
      const decimalsValue = Number(decimalsRaw?.toString?.() ?? decimalsRaw);
      out.set(addr, {
        symbol: typeof symbolRaw === 'string' ? symbolRaw : '',
        decimals: Number.isFinite(decimalsValue) ? decimalsValue : 18,
      });
    });
    return out;
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

  async _initMulticall() {
    if (this._multicallInitPromise) return this._multicallInitPromise;
    const provider = this.readOnlyProvider || this.provider;
    if (!provider || !window.ethers) return false;

    this._multicallInitPromise = this.multicall
      .initialize(provider, Number(CONFIG?.NETWORK?.CHAIN_ID))
      .catch(() => false)
      .finally(() => {
        this._multicallInitPromise = null;
      });
    return await this._multicallInitPromise;
  }

  async _isMulticallReady() {
    if (this.multicall?.isReady?.()) return true;
    return !!(await this._initMulticall());
  }

  _decodeMulticallResult(result, contractOrInterface, methodName) {
    if (!result) return null;
    const success = Array.isArray(result) ? !!result[0] : !!result.success;
    const returnData = Array.isArray(result) ? result[1] : result.returnData;
    if (!success || !returnData || returnData === '0x') return null;
    return this.multicall.decodeResult(contractOrInterface, methodName, returnData);
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

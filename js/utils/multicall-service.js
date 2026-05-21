/**
 * MulticallService (ES module)
 * Batch multiple contract reads into a single RPC call via Multicall2 tryAggregate().
 *
 * This mirrors the approach used in `lib-lp-staking-frontend/js/utils/multicall-service.js`,
 * but implemented as an ES module for this repo.
 */

const MULTICALL2_ABI = [
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
];

export class MulticallService {
  constructor() {
    this.provider = null;
    this.chainId = null;
    this.multicallAddress = null;
    this.multicallContract = null;
    this.isAvailable = false;
  }

  async initialize(provider, chainId, { address } = {}) {
    if (!window.ethers) throw new Error('Ethers.js not loaded');
    this.provider = provider;
    this.chainId = chainId;
    this.multicallAddress = address || null;

    if (!this.multicallAddress) {
      this.isAvailable = false;
      return false;
    }

    this.multicallContract = new window.ethers.Contract(this.multicallAddress, MULTICALL2_ABI, provider);

    // Verify contract exists at address (best-effort)
    try {
      const code = await provider.getCode(this.multicallAddress);
      if (!code || code === '0x') {
        this.isAvailable = false;
        return false;
      }
    } catch {
      this.isAvailable = false;
      return false;
    }

    this.isAvailable = true;
    return true;
  }

  isReady() {
    return !!(this.isAvailable && this.multicallContract);
  }

  createCall(contractOrTarget, methodName, args = []) {
    const contract = contractOrTarget;
    const target = contract.address || contract.target;
    const iface = contract.interface || contract;
    return {
      target,
      callData: iface.encodeFunctionData(methodName, args),
    };
  }

  decodeResult(contractOrInterface, methodName, returnData) {
    const iface = contractOrInterface.interface || contractOrInterface;
    try {
      const decoded = iface.decodeFunctionResult(methodName, returnData);
      // if tuple has one value, return it
      if (Array.isArray(decoded) && decoded.length === 1) return decoded[0];
      return decoded;
    } catch {
      return null;
    }
  }

  async tryAggregate(calls, { requireSuccess = false, blockTag } = {}) {
    if (!this.isReady()) return null;
    if (!Array.isArray(calls) || calls.length === 0) return [];

    const callOptions = blockTag ? { blockTag } : {};
    return await this.multicallContract.tryAggregate(!!requireSuccess, calls, callOptions);
  }

  async batchCall(calls, { requireSuccess = false, blockTag, maxRetries = 0 } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await this.tryAggregate(calls, { requireSuccess, blockTag });
      if (res !== null) return res;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    return null;
  }
}

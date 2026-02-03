export const CONFIG = {
  APP: {
    NAME: 'Liberdus Token Lock',
    // Bump manually for now; later we can automate if needed.
    VERSION: '0.0.0',
    // Phase 9.4 (optional): enable low-priority prefetch of shared reads
    PREFETCH_ON_IDLE: false,
  },

  // Phase 3+
  NETWORK: {
    // Polygon Amoy testnet
    CHAIN_ID: 80002,
    NAME: 'Polygon Amoy',
    // Public RPC. If this endpoint fails, the app will show an error.
    RPC_URL: 'https://rpc-amoy.polygon.technology/',
    BLOCK_EXPLORER: 'https://amoy.polygonscan.com',
    NATIVE_CURRENCY: { name: 'POL', symbol: 'POL', decimals: 18 },
  },

  // Phase 3+
  CONTRACT: {
    // TokenLock contract
    ADDRESS: '0x0Fa98EaEe23c7FD03042A3411114D6c748e9Edc1',
  },
};

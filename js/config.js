const ENVIRONMENTS = {
  bnbtestnet: {
    NETWORK: {
      CHAIN_ID: 97,
      NAME: 'BSC Testnet',
      RPC_URL: 'https://bsc-testnet-dataseed.bnbchain.org',
      RPC_URLS: [
        'https://bsc-testnet-dataseed.bnbchain.org',
        'https://bsc-testnet.bnbchain.org',
        'https://bsc-prebsc-dataseed.bnbchain.org',
      ],
      BLOCK_EXPLORER: 'https://testnet.bscscan.com',
      NATIVE_CURRENCY: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
      MULTICALL2_ADDRESS: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
    CONTRACT: {
      ADDRESS: '0xd77C46da1726cAEC98f10dE9f3e8fF9578608411',
      DEPLOYMENT_BLOCK: 108789771,
    },
  },

  bnbmainnet: {
    NETWORK: {
      CHAIN_ID: 56,
      NAME: 'BNB Smart Chain',
      RPC_URL: 'https://bsc-dataseed.bnbchain.org',
      RPC_URLS: [
        'https://bsc-dataseed.bnbchain.org',
        'https://bsc-dataseed1.defibit.io',
        'https://bsc-dataseed1.ninicoin.io',
      ],
      BLOCK_EXPLORER: 'https://bscscan.com',
      NATIVE_CURRENCY: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      MULTICALL2_ADDRESS: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
    CONTRACT: {
      ADDRESS: '0xb9033f4ceB73798CA00D1cb461BD39D294B3f2F0',
      DEPLOYMENT_BLOCK: 99817280,
    },
  },

  amoy: {
    NETWORK: {
      CHAIN_ID: 80002,
      NAME: 'Polygon Amoy',
      RPC_URL: 'https://rpc-amoy.polygon.technology/',
      RPC_URLS: [
        'https://rpc-amoy.polygon.technology/',
      ],
      BLOCK_EXPLORER: 'https://amoy.polygonscan.com',
      NATIVE_CURRENCY: { name: 'POL', symbol: 'POL', decimals: 18 },
      MULTICALL2_ADDRESS: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
    CONTRACT: {
      ADDRESS: '0xDBe4d7479E2cc3Fa691Ede0D98374Cb1347B43F7',
      DEPLOYMENT_BLOCK: 33346360,
    },
  },

  hardhat: {
    NETWORK: {
      CHAIN_ID: 31337,
      NAME: 'Hardhat',
      RPC_URL: 'http://127.0.0.1:8545',
      RPC_URLS: [
        'http://127.0.0.1:8545',
      ],
      BLOCK_EXPLORER: '',
      NATIVE_CURRENCY: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      MULTICALL2_ADDRESS: '',
    },
    CONTRACT: {
      ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      DEPLOYMENT_BLOCK: 0,
    },
  },
};

const SITE_ENVIRONMENTS = {
  'liberdus.com': 'bnbmainnet',
  localhost: 'bnbtestnet',
  '127.0.0.1': 'bnbtestnet',
  // Add deployed hosts here, for example:
  // 'test.example.com': 'bnbtestnet',
  // 'app.example.com': 'bnbmainnet',
  // 'amoy.example.com': 'amoy',
  // 'hardhat.localhost': 'hardhat',
};

const DEFAULT_ENVIRONMENT = 'bnbmainnet';

function resolveEnvironmentKey() {
  const search = globalThis.location?.search || '';
  const hostname = globalThis.location?.hostname || '';

  const params = new URLSearchParams(search);
  const queryEnv = params.get('env');
  if (queryEnv && ENVIRONMENTS[queryEnv]) return queryEnv;

  const hostEnv = SITE_ENVIRONMENTS[hostname];
  if (hostEnv && ENVIRONMENTS[hostEnv]) return hostEnv;

  return DEFAULT_ENVIRONMENT;
}

const ACTIVE_ENVIRONMENT = resolveEnvironmentKey();
const ACTIVE_CONFIG = ENVIRONMENTS[ACTIVE_ENVIRONMENT];

export const CONFIG = {
  APP: {
    NAME: 'Liberdus Token Lock',
    VERSION: '0.0.0',
    PREFETCH_ON_IDLE: false,
    ENVIRONMENT: ACTIVE_ENVIRONMENT,
  },

  ENVIRONMENTS,
  SITE_ENVIRONMENTS,

  NETWORK: ACTIVE_CONFIG.NETWORK,
  CONTRACT: ACTIVE_CONFIG.CONTRACT,
};

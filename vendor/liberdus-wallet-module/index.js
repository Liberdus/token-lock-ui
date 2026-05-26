import { createWalletDiscovery } from "./core/discovery.js";
import { createWalletSession } from "./core/session.js";

export const DEFAULT_WALLET_SESSION_KEY = "liberdus-wallet-module:walletSession";

function getDefaultStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createWalletCore({
  storage = getDefaultStorage(),
  walletSessionKey = DEFAULT_WALLET_SESSION_KEY,
  discoveryWaitMs = 250,
} = {}) {
  const discovery = createWalletDiscovery({ discoveryWaitMs });
  const session = createWalletSession({
    discovery,
    storage,
    walletSessionKey,
  });

  return {
    discoverWallets: discovery.discoverWallets,
    getAvailableWallets: discovery.getAvailableWallets,
    resolveWalletById: discovery.resolveWalletById,
    getEip1193Provider: discovery.getInjectedProvider,
    applyActiveWallet: discovery.applyActiveWallet,
    connect: session.connect,
    disconnect: session.disconnect,
    sync: session.sync,
    getState: session.getState,
    hasWalletSession: session.hasWalletSession,
    subscribe: session.subscribe,
  };
}

export {
  createWalletConnectButton,
  defineWalletConnectElement,
} from "./ui/wallet-connect.js";

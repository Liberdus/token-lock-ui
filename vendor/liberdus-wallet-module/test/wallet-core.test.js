import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { createWalletCore } from "../index.js";

const ACCOUNT = "0x24f55B1e86D67ca62146618Ee486AA4DF611CDD4";
const WALLET_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

let originalWindow;

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }
}

class ThrowingStorage {
  getItem() {
    throw new Error("getItem blocked");
  }

  setItem() {
    throw new Error("setItem blocked");
  }

  removeItem() {
    throw new Error("removeItem blocked");
  }
}

function createMockProvider({
  account = ACCOUNT,
  chainId = "0x38",
  providerFlags = { isMetaMask: true },
} = {}) {
  const listeners = new Map();
  const requests = [];
  const onCalls = [];
  const removeCalls = [];

  function getListeners(event) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    return listeners.get(event);
  }

  return {
    ...providerFlags,
    requests,
    onCalls,
    removeCalls,
    async request(payload) {
      requests.push(payload);
      if (payload.method === "eth_requestAccounts") return [account];
      if (payload.method === "eth_accounts") return [account];
      if (payload.method === "eth_chainId") return chainId;
      throw new Error(`Unsupported request: ${payload.method}`);
    },
    on(event, handler) {
      onCalls.push(event);
      getListeners(event).add(handler);
    },
    removeListener(event, handler) {
      removeCalls.push(event);
      getListeners(event).delete(handler);
    },
    emit(event, data) {
      for (const handler of getListeners(event)) {
        handler(data);
      }
    },
    listenerCount(event) {
      return getListeners(event).size;
    },
  };
}

function installMockWindow({ provider, storage = new MemoryStorage() }) {
  const listeners = new Map();
  globalThis.window = {
    ethereum: provider,
    localStorage: storage,
    setTimeout: globalThis.setTimeout,
    phantom: undefined,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };

  return storage;
}

beforeEach(() => {
  originalWindow = globalThis.window;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test("discovers a legacy injected wallet", async () => {
  installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, "legacy:default");
  assert.equal(wallets[0].info.name, "MetaMask");
});

test("discovers wallet icons from legacy provider metadata", async () => {
  installMockWindow({
    provider: createMockProvider({
      providerFlags: {
        isMetaMask: true,
        info: {
          name: "MetaMask",
          rdns: "io.metamask",
          icon: WALLET_ICON,
        },
      },
    }),
  });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].info.icon, WALLET_ICON);
});

test("discovers EVM wallets exposed through browser namespaces", async () => {
  const metaMaskProvider = createMockProvider();
  const trustProvider = createMockProvider({ providerFlags: { isTrustWallet: true } });
  const genericProvider = createMockProvider({ providerFlags: {} });
  const listeners = new Map();

  globalThis.window = {
    ethereum: { providers: [metaMaskProvider] },
    trustwallet: { ethereum: trustProvider },
    frontierWallet: { provider: genericProvider },
    localStorage: new MemoryStorage(),
    setTimeout: globalThis.setTimeout,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();
  const walletNames = wallets.map((wallet) => wallet.info.name);

  assert.equal(wallets.length, 3);
  assert.deepEqual(walletNames, ["Trust Wallet", "Frontier Wallet", "MetaMask"]);
});

test("createWalletCore tolerates blocked localStorage getter", async () => {
  const provider = createMockProvider();
  const listeners = new Map();
  globalThis.window = {
    ethereum: provider,
    setTimeout: globalThis.setTimeout,
    phantom: undefined,
    get localStorage() {
      throw new Error("localStorage blocked");
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(walletCore.hasWalletSession(), false);
});

test("connect stores account, chain, selected wallet, and session", async () => {
  const storage = installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.chainId, 56);
  assert.equal(state.selectedWalletId, "legacy:default");
  assert.equal(state.selectedWalletName, "MetaMask");
  assert.equal(walletCore.hasWalletSession(), true);
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({ walletId: "legacy:default" }));
});

test("sync restores an existing wallet session without prompting", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  storage.setItem("test:wallet-session", JSON.stringify({ walletId: "legacy:default" }));

  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.sync();

  assert.equal(walletCore.getState().account, ACCOUNT.toLowerCase());
  assert.deepEqual(provider.requests.map((request) => request.method), [
    "eth_chainId",
    "eth_accounts",
  ]);
});

test("sync clears stale saved sessions without reading fallback accounts", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  storage.setItem("test:wallet-session", JSON.stringify({ walletId: "missing:wallet" }));

  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.sync();

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.chainId, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(state.selectedWalletName, null);
  assert.equal(state.selectedWalletRdns, null);
  assert.equal(state.sessionWalletId, null);
  assert.equal(state.injectedProvider, null);
  assert.equal(state.providerSource, null);
  assert.equal(storage.getItem("test:wallet-session"), null);
  assert.deepEqual(provider.requests, []);
});

test("connect succeeds when session storage throws", async () => {
  installMockWindow({
    provider: createMockProvider(),
    storage: new ThrowingStorage(),
  });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage: globalThis.window.localStorage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.chainId, 56);
  assert.equal(state.selectedWalletId, "legacy:default");
  assert.equal(walletCore.hasWalletSession(), false);
});

test("accountsChanged empty fully clears connected state", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });
  provider.emit("accountsChanged", []);

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.chainId, null);
  assert.equal(state.chainName, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(state.selectedWalletName, null);
  assert.equal(state.selectedWalletRdns, null);
  assert.equal(state.sessionWalletId, null);
  assert.equal(state.injectedProvider, null);
  assert.equal(state.providerSource, null);
  assert.equal(storage.getItem("test:wallet-session"), null);
});

test("unsubscribing the last subscriber removes provider listeners", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const unsubscribe = walletCore.subscribe(() => {});

  assert.equal(provider.listenerCount("accountsChanged"), 1);
  assert.equal(provider.listenerCount("chainChanged"), 1);

  unsubscribe();

  assert.equal(provider.listenerCount("accountsChanged"), 0);
  assert.equal(provider.listenerCount("chainChanged"), 0);
  assert.deepEqual(provider.removeCalls, ["accountsChanged", "chainChanged"]);
});

test("disconnect clears wallet session state", async () => {
  const storage = installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect();

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(walletCore.hasWalletSession(), false);
  assert.equal(storage.getItem("test:wallet-session"), null);
});

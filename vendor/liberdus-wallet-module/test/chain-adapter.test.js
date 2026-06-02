import assert from "node:assert/strict";
import test from "node:test";

import {
  addEthereumChain,
  switchEthereumChain,
  switchOrAddEthereumChain,
  toChainIdHex,
} from "../adapters/chain.js";

function createProvider(handler) {
  const calls = [];
  return {
    calls,
    async request(payload) {
      calls.push(payload);
      return handler?.(payload);
    },
  };
}

test("toChainIdHex converts decimal chain ids", () => {
  assert.equal(toChainIdHex(0), "0x0");
  assert.equal(toChainIdHex(56), "0x38");
  assert.equal(toChainIdHex("97"), "0x61");
  assert.equal(toChainIdHex("0x38"), "0x38");
});

test("toChainIdHex rejects invalid chain ids", () => {
  assert.throws(() => toChainIdHex(null), /non-negative integer/);
  assert.throws(() => toChainIdHex(undefined), /non-negative integer/);
  assert.throws(() => toChainIdHex(""), /non-negative integer/);
  assert.throws(() => toChainIdHex("   "), /non-negative integer/);
  assert.throws(() => toChainIdHex(-1), /non-negative integer/);
  assert.throws(() => toChainIdHex("abc"), /non-negative integer/);
});

test("switchEthereumChain sends the switch wallet RPC", async () => {
  const provider = createProvider();

  await switchEthereumChain(provider, 56);

  assert.deepEqual(provider.calls, [
    {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x38" }],
    },
  ]);
});

test("addEthereumChain sends normalized chain metadata", async () => {
  const provider = createProvider();

  await addEthereumChain(provider, {
    chainId: 56,
    chainName: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    blockExplorerUrl: "https://bscscan.com",
  });

  assert.deepEqual(provider.calls, [
    {
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x38",
          chainName: "BNB Smart Chain",
          rpcUrls: ["https://bsc-dataseed.binance.org"],
          nativeCurrency: {
            name: "BNB",
            symbol: "BNB",
            decimals: 18,
          },
          blockExplorerUrls: ["https://bscscan.com"],
        },
      ],
    },
  ]);
});

test("switchOrAddEthereumChain adds unknown chains then retries switch", async () => {
  let switchAttempts = 0;
  const provider = createProvider(async ({ method }) => {
    if (method === "wallet_switchEthereumChain") {
      switchAttempts += 1;
      if (switchAttempts === 1) {
        const error = new Error("Unknown chain");
        error.code = 4902;
        throw error;
      }
    }
  });

  await switchOrAddEthereumChain(provider, {
    chainId: 56,
    chainName: "BNB Smart Chain",
    rpcUrls: ["https://bsc-dateseed.bnbchain.org"],
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
  });

  assert.deepEqual(provider.calls.map((call) => call.method), [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
});

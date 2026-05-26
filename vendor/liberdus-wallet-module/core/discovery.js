const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
const LEGACY_WALLET_PREFIX = "legacy";
const LEGACY_DEFAULT_WALLET_ID = `${LEGACY_WALLET_PREFIX}:default`;
const AMBIGUOUS_WALLET_ID = Symbol("ambiguous-wallet-id");

function createWalletId(source, name, fallback = "wallet") {
  return `${source}:${String(name || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || fallback}`;
}

function normalizeWalletIdentityValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWalletIcon(value) {
  const icon = String(value || "").trim();
  if (!icon) return "";

  return /^(data:image\/|https?:\/\/|ipfs:\/\/|ar:\/\/|blob:|chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\/)/i.test(icon)
    ? icon
    : "";
}

function normalizeWalletInfo(info = {}) {
  return {
    uuid: normalizeWalletIdentityValue(info.uuid),
    name: String(info.name || "").trim(),
    icon: normalizeWalletIcon(info.icon),
    rdns: normalizeWalletIdentityValue(info.rdns),
  };
}

function isObjectLike(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function safeGetProperty(target, propertyName) {
  try {
    return target?.[propertyName];
  } catch {
    return undefined;
  }
}

function safeGetNestedProperty(target, propertyNames) {
  return propertyNames.reduce((value, propertyName) => safeGetProperty(value, propertyName), target);
}

function firstStringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstWalletIconValue(...values) {
  for (const value of values) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const icon = normalizeWalletIcon(candidate);
      if (icon) return icon;
    }
  }
  return "";
}

function isEip1193Provider(provider) {
  return isObjectLike(provider) && typeof provider.request === "function";
}

function matchesWalletNamespaceProvider(namespaceProvider, provider) {
  if (!namespaceProvider || !provider) return false;
  if (namespaceProvider === provider) return true;

  const namespaceProviders = Array.isArray(namespaceProvider.providers)
    ? namespaceProvider.providers
    : [];
  const candidateProviders = Array.isArray(provider.providers)
    ? provider.providers
    : [];

  return namespaceProviders.includes(provider) || candidateProviders.includes(namespaceProvider);
}

function isPhantomNamespaceProvider(provider) {
  if (typeof window === "undefined") return false;
  return matchesWalletNamespaceProvider(safeGetProperty(safeGetProperty(window, "phantom"), "ethereum"), provider);
}

function formatNamespaceWalletName(namespace) {
  const normalized = String(namespace || "")
    .replace(/^is/i, "")
    .replace(/wallet$/i, " Wallet")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!normalized) return "Injected Wallet";
  return normalized
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function guessLegacyWalletName(provider) {
  if (provider?.isPhantom || isPhantomNamespaceProvider(provider)) return "Phantom";
  if (provider?.isTrust || provider?.isTrustWallet) return "Trust Wallet";
  if (provider?.isOkxWallet || provider?.isOKExWallet) return "OKX Wallet";
  if (provider?.isRabby) return "Rabby";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isBraveWallet) return "Brave Wallet";
  if (provider?.isFrame) return "Frame";
  if (provider?.isTally) return "Taho";
  if (provider?.isMetaMask) return "MetaMask";
  return "Injected Wallet";
}

function guessLegacyWalletRdns(provider) {
  if (provider?.isPhantom || isPhantomNamespaceProvider(provider)) return "com.phantom.browser";
  if (provider?.isTrust || provider?.isTrustWallet) return "com.trustwallet.app";
  if (provider?.isOkxWallet || provider?.isOKExWallet) return "com.okex.wallet";
  if (provider?.isRabby) return "io.rabby";
  if (provider?.isCoinbaseWallet) return "com.coinbase.wallet";
  if (provider?.isBraveWallet) return "com.brave.wallet";
  if (provider?.isFrame) return "sh.frame";
  if (provider?.isTally) return "so.tally";
  if (provider?.isMetaMask) return "io.metamask";
  return "";
}

function getProviderWalletInfo(provider) {
  const info = safeGetProperty(provider, "info") || {};
  const providerInfo = safeGetProperty(provider, "providerInfo") || {};
  const walletInfo = safeGetProperty(provider, "walletInfo") || {};
  const metadata = safeGetProperty(provider, "metadata") || {};
  const peerMetadata = safeGetNestedProperty(provider, ["session", "peer", "metadata"]) || {};

  return {
    name: firstStringValue(
      safeGetProperty(info, "name"),
      safeGetProperty(providerInfo, "name"),
      safeGetProperty(walletInfo, "name"),
      safeGetProperty(metadata, "name"),
      safeGetProperty(peerMetadata, "name"),
    ),
    rdns: firstStringValue(
      safeGetProperty(info, "rdns"),
      safeGetProperty(providerInfo, "rdns"),
      safeGetProperty(walletInfo, "rdns"),
      safeGetProperty(metadata, "rdns"),
    ),
    uuid: firstStringValue(
      safeGetProperty(info, "uuid"),
      safeGetProperty(providerInfo, "uuid"),
      safeGetProperty(walletInfo, "uuid"),
      safeGetProperty(metadata, "uuid"),
    ),
    icon: firstWalletIconValue(
      safeGetProperty(info, "icon"),
      safeGetProperty(info, "icons"),
      safeGetProperty(providerInfo, "icon"),
      safeGetProperty(providerInfo, "icons"),
      safeGetProperty(walletInfo, "icon"),
      safeGetProperty(walletInfo, "icons"),
      safeGetProperty(metadata, "icon"),
      safeGetProperty(metadata, "icons"),
      safeGetProperty(peerMetadata, "icon"),
      safeGetProperty(peerMetadata, "icons"),
    ),
  };
}

function inferLegacyWalletInfo(provider, namespace = "", info = {}) {
  const providerInfo = getProviderWalletInfo(provider);
  const guessedName = guessLegacyWalletName(provider);
  const guessedRdns = guessLegacyWalletRdns(provider);

  return {
    name: info.name
      || providerInfo.name
      || (guessedName === "Injected Wallet" ? formatNamespaceWalletName(namespace) : guessedName),
    rdns: info.rdns || providerInfo.rdns || guessedRdns,
    icon: info.icon || providerInfo.icon || "",
    uuid: info.uuid || providerInfo.uuid || "",
  };
}

function inferNamespaceWalletInfo(provider, namespace) {
  const info = inferLegacyWalletInfo(provider, namespace);
  return {
    name: info.name,
    rdns: info.rdns,
    icon: info.icon,
    uuid: info.uuid,
  };
}

function mergeWalletInfo(primary = {}, secondary = {}) {
  return {
    uuid: String(primary.uuid || secondary.uuid || ""),
    name: String(primary.name || secondary.name || "Injected Wallet"),
    icon: normalizeWalletIcon(primary.icon || secondary.icon || ""),
    rdns: String(primary.rdns || secondary.rdns || ""),
  };
}

function mergeLinkedProviders(...providers) {
  return [...new Set(providers.filter(Boolean))];
}

function getWalletSourcePriority(source) {
  return source === "eip6963" ? 0 : 1;
}

function createWalletDescriptor(candidate, previous = null) {
  const candidateSource = candidate.source || previous?.source || LEGACY_WALLET_PREFIX;
  const candidatePriority = getWalletSourcePriority(candidateSource);
  const previousPriority = previous?.sourcePriority ?? Number.POSITIVE_INFINITY;
  const isFreshEip6963Announcement = previous
    && candidateSource === "eip6963"
    && previous.source === "eip6963";
  const preferCandidate = !previous || candidatePriority < previousPriority || isFreshEip6963Announcement;

  return {
    id: candidate.id,
    provider: preferCandidate ? candidate.provider : (previous?.provider || candidate.provider),
    linkedProviders: mergeLinkedProviders(previous?.provider, candidate.provider),
    source: preferCandidate ? candidateSource : (previous?.source || candidateSource),
    sourcePriority: preferCandidate ? candidatePriority : (previous?.sourcePriority ?? candidatePriority),
    sortIndex: previous
      ? (preferCandidate ? (candidate.sortIndex ?? previous.sortIndex) : previous.sortIndex)
      : (candidate.sortIndex ?? 0),
    info: mergeWalletInfo(
      preferCandidate ? candidate.info : previous?.info,
      preferCandidate ? previous?.info : candidate.info,
    ),
  };
}

function getWalletSortLabel(wallet) {
  return `${wallet.info?.name || ""}|${wallet.info?.rdns || ""}|${wallet.id || ""}`.toLowerCase();
}

export function createWalletDiscovery({ discoveryWaitMs = 250 } = {}) {
  const discoveredWallets = new Map();
  const walletAliasIds = new Map();
  let providerIds = new WeakMap();
  let walletIdsByUuid = new Map();
  let walletIdsByRdns = new Map();
  let discoveryInitialized = false;
  let activeInjectedProvider = null;
  let boundWalletEventProvider = null;
  let boundAccountsChanged = null;
  let boundChainChanged = null;
  let nextEip6963SortIndex = 0;
  const walletEventSubscribers = new Set();

  function emitEvent(event, data) {
    walletEventSubscribers.forEach((subscriber) => {
      try {
        if (typeof subscriber === "function") {
          subscriber(event, data);
        } else if (subscriber && typeof subscriber.handleEvent === "function") {
          subscriber.handleEvent(event, data);
        }
      } catch {
        // ignore subscriber errors
      }
    });
  }

  function listWalletsSnapshot() {
    return [...discoveredWallets.values()].sort((left, right) => {
      if (left.sourcePriority !== right.sourcePriority) {
        return left.sourcePriority - right.sourcePriority;
      }
      if (left.sortIndex !== right.sortIndex) {
        return left.sortIndex - right.sortIndex;
      }
      return getWalletSortLabel(left).localeCompare(getWalletSortLabel(right));
    });
  }

  function rebuildWalletLookups() {
    providerIds = new WeakMap();
    walletIdsByUuid = new Map();
    walletIdsByRdns = new Map();

    for (const wallet of discoveredWallets.values()) {
      for (const provider of mergeLinkedProviders(wallet.provider, ...(wallet.linkedProviders || []))) {
        providerIds.set(provider, wallet.id);
      }
      if (wallet.info?.uuid) {
        walletIdsByUuid.set(wallet.info.uuid, wallet.id);
      }
      if (wallet.info?.rdns) {
        const existingWalletId = walletIdsByRdns.get(wallet.info.rdns);
        if (!existingWalletId) {
          walletIdsByRdns.set(wallet.info.rdns, wallet.id);
        } else if (existingWalletId !== wallet.id) {
          walletIdsByRdns.set(wallet.info.rdns, AMBIGUOUS_WALLET_ID);
        }
      }
    }
  }

  function resolveWalletAlias(walletId) {
    let resolvedWalletId = String(walletId || "");
    const visited = new Set();

    while (walletAliasIds.has(resolvedWalletId) && !visited.has(resolvedWalletId)) {
      visited.add(resolvedWalletId);
      resolvedWalletId = walletAliasIds.get(resolvedWalletId);
    }

    return resolvedWalletId;
  }

  function findWalletById(walletId) {
    if (!walletId) return null;
    return discoveredWallets.get(resolveWalletAlias(walletId)) || null;
  }

  function findWalletId(provider, info = {}, source = LEGACY_WALLET_PREFIX) {
    const existingProviderId = providerIds.get(provider);
    if (existingProviderId) return existingProviderId;

    if (info.uuid && walletIdsByUuid.has(info.uuid)) {
      return walletIdsByUuid.get(info.uuid);
    }

    if (info.rdns) {
      const rdnsWalletId = walletIdsByRdns.get(info.rdns);
      if (rdnsWalletId && rdnsWalletId !== AMBIGUOUS_WALLET_ID) {
        const rdnsWallet = discoveredWallets.get(rdnsWalletId) || null;
        if (source === "eip6963" && info.uuid && rdnsWallet?.source !== LEGACY_WALLET_PREFIX) {
          return null;
        }
        return rdnsWalletId;
      }
    }

    if (source === "eip6963" && info.uuid) {
      return null;
    }

    return null;
  }

  function hasDiscoveredEip6963Wallets() {
    return [...discoveredWallets.values()].some((wallet) => wallet.source === "eip6963");
  }

  function pruneLegacyShimWallets(latestWallet) {
    if (!latestWallet || typeof window === "undefined") return false;

    const ethereum = window.ethereum;
    if (!ethereum || Array.isArray(ethereum.providers)) return false;

    let changed = false;
    for (const wallet of [...discoveredWallets.values()]) {
      if (wallet.id === latestWallet.id) continue;
      if (wallet.source !== LEGACY_WALLET_PREFIX) continue;
      if (wallet.provider !== ethereum) continue;

      discoveredWallets.delete(wallet.id);
      changed = true;
    }

    if (changed) {
      rebuildWalletLookups();
    }

    return changed;
  }

  function syncWalletEventProvider() {
    const nextProvider = walletEventSubscribers.size ? activeInjectedProvider || getReadOnlyInjectedProvider() : null;

    if (!nextProvider?.on) {
      if (boundWalletEventProvider) {
        try {
          boundWalletEventProvider.removeListener("accountsChanged", boundAccountsChanged);
          boundWalletEventProvider.removeListener("chainChanged", boundChainChanged);
        } catch {
          // ignore
        }
      }
      boundWalletEventProvider = null;
      boundAccountsChanged = null;
      boundChainChanged = null;
      return;
    }

    if (boundWalletEventProvider === nextProvider) {
      return;
    }

    if (boundWalletEventProvider && boundAccountsChanged && boundChainChanged) {
      try {
        boundWalletEventProvider.removeListener("accountsChanged", boundAccountsChanged);
        boundWalletEventProvider.removeListener("chainChanged", boundChainChanged);
      } catch {
        // ignore
      }
    }

    boundAccountsChanged = async (accounts) => {
      emitEvent("accountChanged", accounts);
    };

    boundChainChanged = async (chainId) => {
      emitEvent("chainChanged", chainId);
    };

    nextProvider.on("accountsChanged", boundAccountsChanged);
    nextProvider.on("chainChanged", boundChainChanged);
    boundWalletEventProvider = nextProvider;
  }

  function getReadOnlyInjectedProvider() {
    const discoveredProvider = listWalletsSnapshot()[0]?.provider || null;
    if (discoveredProvider) return discoveredProvider;
    if (typeof window !== "undefined" && window.ethereum) return window.ethereum;
    return null;
  }

  function registerWallet(candidate) {
    const provider = candidate?.provider;
    if (!provider || typeof provider.request !== "function") return null;

    const normalizedInfo = normalizeWalletInfo(candidate.info);
    const walletId = findWalletId(provider, normalizedInfo, candidate?.source || LEGACY_WALLET_PREFIX)
      || candidate?.id
      || createWalletId(
        candidate?.source || LEGACY_WALLET_PREFIX,
        normalizedInfo.name || guessLegacyWalletName(provider),
        "wallet",
      );
    const previousWallet = discoveredWallets.get(walletId) || null;
    const nextWallet = createWalletDescriptor({
      id: walletId,
      provider,
      source: candidate?.source || LEGACY_WALLET_PREFIX,
      sortIndex: candidate?.sortIndex ?? previousWallet?.sortIndex ?? 0,
      info: normalizedInfo,
    }, previousWallet);

    discoveredWallets.set(walletId, nextWallet);
    if (candidate?.id && candidate.id !== walletId) {
      walletAliasIds.set(candidate.id, walletId);
    }

    rebuildWalletLookups();
    if (activeInjectedProvider === previousWallet?.provider && previousWallet?.provider !== nextWallet.provider) {
      activeInjectedProvider = nextWallet.provider;
    }
    syncWalletEventProvider();
    emitEvent("providersChanged", listWalletsSnapshot());
    return nextWallet;
  }

  function registerLegacyWallet(provider, index = 0) {
    const info = inferLegacyWalletInfo(provider);
    return registerWallet({
      id: index === 0 ? LEGACY_DEFAULT_WALLET_ID : createWalletId(LEGACY_WALLET_PREFIX, `${info.name}-${index + 1}`),
      provider,
      source: LEGACY_WALLET_PREFIX,
      sortIndex: index,
      info,
    });
  }

  function registerLegacyWalletCandidate(candidate, index = 0) {
    const provider = candidate?.provider;
    const info = inferLegacyWalletInfo(provider, "", candidate?.info || {});
    const name = info.name || guessLegacyWalletName(provider);
    return registerWallet({
      id: candidate?.id || (index === 0
        ? LEGACY_DEFAULT_WALLET_ID
        : createWalletId(LEGACY_WALLET_PREFIX, `${name}-${index + 1}`)),
      provider,
      source: LEGACY_WALLET_PREFIX,
      sortIndex: index,
      info,
    });
  }

  function collectNamespaceWalletCandidates() {
    if (typeof window === "undefined") return [];

    const candidates = [];
    const seenProviders = new Set();

    function addProvider(provider, namespace) {
      if (!isEip1193Provider(provider) || seenProviders.has(provider)) return;
      seenProviders.add(provider);
      candidates.push({
        id: createWalletId(LEGACY_WALLET_PREFIX, namespace || guessLegacyWalletName(provider), "wallet"),
        provider,
        info: inferNamespaceWalletInfo(provider, namespace),
      });
    }

    let propertyNames = [];
    try {
      propertyNames = Object.getOwnPropertyNames(window);
    } catch {
      propertyNames = [];
    }

    for (const propertyName of propertyNames) {
      if (propertyName === "ethereum") continue;
      const value = safeGetProperty(window, propertyName);
      if (!isObjectLike(value)) continue;

      addProvider(value, propertyName);
      addProvider(safeGetProperty(value, "ethereum"), propertyName);
      addProvider(safeGetProperty(value, "provider"), propertyName);
    }

    return candidates;
  }

  function collectLegacyWallets() {
    if (typeof window === "undefined") return [];

    const ethereum = safeGetProperty(window, "ethereum");
    const namespaceCandidates = collectNamespaceWalletCandidates();
    const rawProviders = Array.isArray(ethereum?.providers) && ethereum.providers.length
      ? ethereum.providers
      : [];
    const uniqueProviders = [...new Set(rawProviders.filter(Boolean))]
      .filter((provider) => !namespaceCandidates.some((candidate) => candidate.provider === provider));
    const candidateProviders = [
      ...namespaceCandidates,
      ...uniqueProviders.map((provider) => ({
        provider,
        info: inferLegacyWalletInfo(provider),
      })),
    ];

    if (candidateProviders.length) {
      return candidateProviders
        .map((candidate, index) => registerLegacyWalletCandidate(candidate, index))
        .filter(Boolean);
    }

    if (hasDiscoveredEip6963Wallets()) {
      return [];
    }

    if (!ethereum || providerIds.get(ethereum)) {
      return [];
    }

    const wallet = registerLegacyWallet(ethereum, 0);
    return wallet ? [wallet] : [];
  }

  function requestWalletAnnouncements() {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));
    } catch {
      // Some browsers may reject synthetic events during teardown.
    }
  }

  function initWalletDiscovery() {
    if (discoveryInitialized || typeof window === "undefined") return;
    discoveryInitialized = true;

    window.addEventListener(EIP6963_ANNOUNCE_EVENT, (event) => {
      const detail = event?.detail;
      if (!detail?.provider) return;

      const wallet = registerWallet({
        id: detail.info?.uuid || detail.info?.rdns || createWalletId("eip6963", detail.info?.name, "wallet"),
        provider: detail.provider,
        source: "eip6963",
        sortIndex: nextEip6963SortIndex++,
        info: detail.info || {},
      });

      if (pruneLegacyShimWallets(wallet)) {
        syncWalletEventProvider();
      }
    });

    collectLegacyWallets();
    requestWalletAnnouncements();
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function discoverWallets(waitMs = discoveryWaitMs) {
    initWalletDiscovery();
    collectLegacyWallets();
    requestWalletAnnouncements();

    if (waitMs > 0) {
      await wait(waitMs);
      collectLegacyWallets();
    }

    return listWalletsSnapshot();
  }

  function applyActiveWallet(wallet) {
    activeInjectedProvider = wallet?.provider || null;
    syncWalletEventProvider();
    emitEvent("providersChanged", listWalletsSnapshot());
  }

  function getInjectedProvider() {
    return activeInjectedProvider || getReadOnlyInjectedProvider();
  }

  async function resolveWalletById(walletId) {
    if (!walletId) return null;
    await discoverWallets();
    return findWalletById(walletId);
  }

  function getAvailableWallets() {
    return listWalletsSnapshot().map((wallet) => ({
      id: wallet.id,
      source: wallet.source,
      info: { ...wallet.info },
    }));
  }

  return {
    discoverWallets,
    getAvailableWallets,
    resolveWalletById,
    applyActiveWallet,
    getInjectedProvider,
    subscribe: (handler) => {
      walletEventSubscribers.add(handler);
      initWalletDiscovery();
      syncWalletEventProvider();
      return () => {
        walletEventSubscribers.delete(handler);
        syncWalletEventProvider();
      };
    },
  };
}

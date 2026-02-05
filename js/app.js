import { CONFIG } from './config.js';
import { Header } from './components/header.js';
import { TabBar } from './components/tab-bar.js';
import { OverviewTab } from './components/overview-tab.js';
import { LockActionToasts } from './components/unlock-tab.js';
import { ParametersTab } from './components/parameters-tab.js';
import { HistoryTab } from './components/history-tab.js';
import { ToastManager } from './components/toast-manager.js';
import { WalletManager } from './wallet/wallet-manager.js';
import { NetworkManager } from './wallet/network-manager.js';
import { WalletPopup } from './wallet/wallet-popup.js';
import { ContractManager } from './contracts/contract-manager.js';

// Instantiate globally (web-client-v2 pattern)
const header = new Header();
const tabBar = new TabBar();
const overviewTab = new OverviewTab();
const lockActionToasts = new LockActionToasts();
const parametersTab = new ParametersTab();
const historyTab = new HistoryTab();
const toastManager = new ToastManager();
const walletManager = new WalletManager();
const networkManager = new NetworkManager({ walletManager });
const walletPopup = new WalletPopup({ walletManager, networkManager });
const contractManager = new ContractManager({ walletManager, networkManager });

const CACHE_PREFIXES = [
  'liberdus_token_ui:token_meta:v1:',
  'liberdus_token_ui:history:cache:v1:',
];

function clearLocalCaches() {
  let removed = 0;
  try {
    const storage = window.localStorage;
    if (!storage) return removed;
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    keys.forEach((key) => {
      if (CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
        removed += 1;
      }
    });
  } catch {
    return removed;
  }
  return removed;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Basic config exposure (helpful during dev)
  window.CONFIG = CONFIG;

  // Set app version in header
  const versionEl = document.querySelector('.app-version');
  if (versionEl && CONFIG?.APP?.VERSION) {
    versionEl.textContent = `(${CONFIG.APP.VERSION})`;
  }

  // Wallet system globals (lp-staking pattern; used by Header/Popup)
  window.walletManager = walletManager;
  window.networkManager = networkManager;
  window.walletPopup = walletPopup;
  window.contractManager = contractManager;
  window.toastManager = toastManager;
  window.tabBar = tabBar;
  window.lockActionToasts = lockActionToasts;
  window.overviewTab = overviewTab;
  window.historyTab = historyTab;

  toastManager.load();
  walletManager.load();
  await walletManager.init();
  networkManager.load();
  walletPopup.load();
  await contractManager.load();
  
  header.load();

  overviewTab.load();
  lockActionToasts.load();
  parametersTab.load();
  historyTab.load();

  const openLockActionBtn = document.getElementById('open-lock-action-btn');
  openLockActionBtn?.addEventListener('click', () => {
    window.lockActionToasts?.openLockToast?.();
  });

  const clearCacheLink = document.getElementById('app-clear-cache');
  clearCacheLink?.addEventListener('click', (event) => {
    event.preventDefault();
    const removed = clearLocalCaches();
    window.overviewTab?.clearLocalCache?.();
    window.historyTab?.clearLocalCache?.();
    window.lockActionToasts?.clearLocalCache?.();
    const message = removed > 0
      ? `Cleared ${removed} cached item${removed === 1 ? '' : 's'}.`
      : 'No cached data to clear.';
    window.toastManager?.success(message, { title: 'Cache', timeoutMs: 2500 });
  });

  // Load TabBar last so the initial `tabActivated` event
  // is received by all tab components (lazy tab loading).
  tabBar.load();

  // No background prefetch for this UI yet.
});

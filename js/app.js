import { CONFIG } from './config.js';
import { Header } from './components/header.js';
import { TabBar } from './components/tab-bar.js';
import { OverviewTab } from './components/overview-tab.js';
import { LockTab } from './components/lock-tab.js';
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
const lockTab = new LockTab();
const lockActionToasts = new LockActionToasts();
const parametersTab = new ParametersTab();
const historyTab = new HistoryTab();
const toastManager = new ToastManager();
const walletManager = new WalletManager();
const networkManager = new NetworkManager({ walletManager });
const walletPopup = new WalletPopup({ walletManager, networkManager });
const contractManager = new ContractManager({ walletManager, networkManager });

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
  lockTab.load();
  lockActionToasts.load();
  parametersTab.load();
  historyTab.load();

  // Load TabBar last so the initial `tabActivated` event
  // is received by all tab components (lazy tab loading).
  tabBar.load();

  // No background prefetch for this UI yet.
});

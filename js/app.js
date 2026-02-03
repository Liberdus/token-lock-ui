import { CONFIG } from './config.js';
import { Header } from './components/header.js';
import { LocksPage } from './components/locks-page.js';
import { ToastManager } from './components/toast-manager.js';
import { WalletManager } from './wallet/wallet-manager.js';
import { NetworkManager } from './wallet/network-manager.js';
import { WalletPopup } from './wallet/wallet-popup.js';
import { ContractManager } from './contracts/contract-manager.js';

// Instantiate globally (web-client-v2 pattern)
const header = new Header();
const locksPage = new LocksPage();
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

  toastManager.load();
  walletManager.load();
  await walletManager.init();
  networkManager.load();
  walletPopup.load();
  await contractManager.load();
  
  header.load();

  locksPage.load();

  const clearBtn = document.getElementById('app-clear-cache');
  clearBtn?.addEventListener('click', () => {
    window.toastManager?.success('No cached data to clear.', { title: 'Cache' });
  });

  // Load TabBar last so the initial `tabActivated` event
  // is received by all tab components (lazy tab loading).
  tabBar.load();

  // No background prefetch for this UI yet.
});

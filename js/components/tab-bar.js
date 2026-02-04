export class TabBar {
  constructor() {
    this.tabButtons = [];
    this.tabPanelsByName = new Map();
    this.activeTab = null;
    this._activatedTabs = new Set();
  }

  load() {
    this.tabButtons = Array.from(document.querySelectorAll('.tab-button[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.tab-panel[data-panel]'));
    this.tabPanelsByName = new Map(panels.map((p) => [p.dataset.panel, p]));

    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        this.switchTab(tabName, { updateHash: true, focusPanel: false });
      });

      btn.addEventListener('keydown', (e) => this.onTabKeyDown(e));
    });

    window.addEventListener('hashchange', () => this.applyHash());

    // Initial selection
    this.applyHash();
  }

  applyHash() {
    const hash = (window.location.hash || '').replace(/^#/, '').trim();
    const isVisibleTab = this.tabButtons.some((btn) => btn.dataset.tab === hash);
    const next = hash && this.tabPanelsByName.has(hash) && isVisibleTab ? hash : 'overview';
    this.switchTab(next, { updateHash: false, focusPanel: false });
  }

  switchTab(tabName, { updateHash = false, focusPanel = false } = {}) {
    if (!tabName || !this.tabPanelsByName.has(tabName)) return;
    if (this.activeTab === tabName) return;

    const previousTabName = this.activeTab;
    this.activeTab = tabName;
    const isFirstActivation = !this._activatedTabs.has(tabName);
    this._activatedTabs.add(tabName);

    // Tabs (buttons)
    this.tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
    });

    // Panels
    for (const [name, panel] of this.tabPanelsByName.entries()) {
      const isActive = name === tabName;
      panel.classList.toggle('is-active', isActive);
      panel.toggleAttribute('hidden', !isActive);
    }

    if (updateHash) {
      // Avoid pushing history entries for tab changes.
      const nextHash = `#${tabName}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    }

    if (focusPanel) {
      this.tabPanelsByName.get(tabName)?.focus();
    }

    // Notify app components
    if (previousTabName) {
      document.dispatchEvent(
        new CustomEvent('tabDeactivated', { detail: { tabName: previousTabName, nextTabName: tabName } })
      );
    }
    document.dispatchEvent(
      new CustomEvent('tabActivated', { detail: { tabName, previousTabName, isFirstActivation } })
    );
  }

  onTabKeyDown(e) {
    const { key } = e;
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(key)) return;

    const currentIndex = this.tabButtons.findIndex((b) => b.dataset.tab === this.activeTab);
    if (currentIndex < 0) return;

    const lastIndex = this.tabButtons.length - 1;
    let nextIndex = currentIndex;

    if (key === 'ArrowLeft') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    if (key === 'ArrowRight') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    if (key === 'Home') nextIndex = 0;
    if (key === 'End') nextIndex = lastIndex;

    if (nextIndex !== currentIndex) {
      e.preventDefault();
      this.tabButtons[nextIndex]?.focus();
      return;
    }

    // Activate focused tab
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      const focused = document.activeElement;
      if (focused && focused.classList?.contains('tab-button')) {
        const tabName = focused.dataset.tab;
        this.switchTab(tabName, { updateHash: true, focusPanel: true });
      }
    }
  }
}

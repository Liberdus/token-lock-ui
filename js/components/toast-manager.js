export class ToastManager {
  constructor({ containerId = 'notification-container' } = {}) {
    this.containerId = containerId;
    this.container = null;
    this._toasts = new Map(); // id -> { el, timeoutId, showTimerId }
    this._nextId = 1;
  }

  load() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = this.containerId;
      // Append to #app container (for relative positioning)
      const appContainer = document.getElementById('app');
      (appContainer || document.body).appendChild(this.container);
    }

    this.container.classList.add('notification-container');
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-relevant', 'additions');
  }

  show({ title, message, type = 'info', timeoutMs, id, dismissible = true, delayMs = 0, allowHtml = false } = {}) {
    const toastId = id || `t${this._nextId++}`;

    // If already exists, update instead.
    if (this._toasts.has(toastId)) {
      this.update(toastId, { title, message, type, timeoutMs, dismissible, allowHtml });
      return toastId;
    }

    const create = () => {
      const el = document.createElement('div');
      el.className = `notification ${type}`;
      el.setAttribute('data-toast-id', toastId);
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');

      // Icon based on type
      const iconMap = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
        loading: '', // Loading uses CSS spinner instead of character
      };
      const icon = iconMap[type] || 'ℹ';

      el.innerHTML = `
        <div class="notification-icon" aria-hidden="true">${type === 'loading' ? '<span class="spinner"></span>' : icon}</div>
        <div class="notification-content">
          ${title ? `<div class="notification-title"></div>` : ''}
          <div class="notification-message"></div>
        </div>
        ${dismissible ? `<button type="button" class="notification-close" aria-label="Dismiss">×</button>` : ''}
      `;

      if (title) el.querySelector('.notification-title').textContent = String(title);
      const messageEl = el.querySelector('.notification-message');
      if (messageEl) {
        if (allowHtml) {
          messageEl.innerHTML = this._sanitizeMessageHtml(message);
        } else {
          messageEl.textContent = String(message || '');
        }
      }

      const closeBtn = el.querySelector('.notification-close');
      closeBtn?.addEventListener('click', () => this.dismiss(toastId));

      this.container.appendChild(el);
      // Trigger entry animation (match lib-lp-staking-frontend style).
      requestAnimationFrame(() => el.classList.add('show'));

      const rec = { el, timeoutId: null, showTimerId: null };
      this._toasts.set(toastId, rec);

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        rec.timeoutId = window.setTimeout(() => this.dismiss(toastId), timeoutMs);
      }
    };

    if (delayMs && delayMs > 0) {
      const showTimerId = window.setTimeout(create, delayMs);
      this._toasts.set(toastId, { el: null, timeoutId: null, showTimerId });
    } else {
      create();
    }

    return toastId;
  }

  loading(message, { title = 'Loading', id, delayMs = 200, allowHtml = false } = {}) {
    return this.show({ id, title, message, type: 'loading', timeoutMs: 0, dismissible: false, delayMs, allowHtml });
  }

  success(message, { title = 'Done', timeoutMs = 2500, id, allowHtml = false } = {}) {
    return this.show({ id, title, message, type: 'success', timeoutMs, dismissible: true, allowHtml });
  }

  error(message, { title = 'Error', timeoutMs = 0, id, allowHtml = false } = {}) {
    // Error toasts stay until user dismisses them (timeoutMs = 0 means no auto-dismiss)
    return this.show({ id, title, message, type: 'error', timeoutMs, dismissible: true, allowHtml });
  }

  update(id, { title, message, type, timeoutMs, dismissible, allowHtml = false } = {}) {
    const rec = this._toasts.get(id);
    if (!rec) return false;

    // If pending delayed show, cancel and show immediately with updated content.
    if (!rec.el && rec.showTimerId) {
      window.clearTimeout(rec.showTimerId);
      this._toasts.delete(id);
      this.show({ id, title, message, type, timeoutMs, dismissible, delayMs: 0, allowHtml });
      return true;
    }

    const el = rec.el;
    if (!el) return false;

    if (type) {
      el.className = `notification ${type}`;
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
      // Update icon
      const iconMap = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
        loading: '',
      };
      const iconEl = el.querySelector('.notification-icon');
      if (iconEl) {
        if (type === 'loading') {
          iconEl.innerHTML = '<span class="spinner"></span>';
        } else {
          iconEl.textContent = iconMap[type] || 'ℹ';
        }
      }
    }
    if (typeof title === 'string') {
      const titleEl = el.querySelector('.notification-title');
      if (titleEl) titleEl.textContent = title;
    }
    if (typeof message === 'string') {
      const msgEl = el.querySelector('.notification-message');
      if (msgEl) {
        if (allowHtml) {
          msgEl.innerHTML = this._sanitizeMessageHtml(message);
        } else {
          msgEl.textContent = message;
        }
      }
    }

    if (rec.timeoutId) window.clearTimeout(rec.timeoutId);
    rec.timeoutId = null;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      rec.timeoutId = window.setTimeout(() => this.dismiss(id), timeoutMs);
    }

    if (typeof dismissible === 'boolean') {
      const closeBtn = el.querySelector('.notification-close');
      if (!dismissible && closeBtn) closeBtn.remove();
      if (dismissible && !closeBtn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'notification-close';
        btn.setAttribute('aria-label', 'Dismiss');
        btn.textContent = '×';
        btn.addEventListener('click', () => this.dismiss(id));
        el.appendChild(btn);
      }
    }

    return true;
  }

  _sanitizeMessageHtml(message) {
    const container = document.createElement('div');
    container.innerHTML = String(message || '');

    const fragment = document.createDocumentFragment();
    const appendSanitized = (node, parent) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (tag === 'a') {
        const a = document.createElement('a');
        const href = node.getAttribute('href') || '';
        if (href && !/^javascript:/i.test(href)) {
          a.setAttribute('href', href);
        } else {
          a.setAttribute('href', '#');
        }
        if (node.getAttribute('target') === '_blank') {
          a.setAttribute('target', '_blank');
        }
        a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = node.textContent || '';
        parent.appendChild(a);
        return;
      }
      
      if (tag === 'br') {
        parent.appendChild(document.createElement('br'));
        return;
      }

      parent.appendChild(document.createTextNode(node.textContent || ''));
    };

    container.childNodes.forEach((node) => appendSanitized(node, fragment));
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper.innerHTML;
  }

  dismiss(id) {
    const rec = this._toasts.get(id);
    if (!rec) return false;

    if (rec.showTimerId) window.clearTimeout(rec.showTimerId);
    if (rec.timeoutId) window.clearTimeout(rec.timeoutId);

    const el = rec.el;
    if (el) {
      el.classList.add('hide');
      // Remove after animation
      setTimeout(() => {
        el.remove();
      }, 400);
    }
    this._toasts.delete(id);
    return true;
  }
}


const TOAST_TYPES = new Set(['success', 'error', 'warning', 'info', 'loading']);
const TOAST_ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
  loading: '',
};
const FORM_TOAST_CLASS = 'notification--form';

export class ToastManager {
  constructor({ containerId = 'notification-container', formContainerId = `${containerId}-form` } = {}) {
    this.containerId = containerId;
    this.formContainerId = formContainerId;
    this.container = null;
    this.formContainer = null;
    this._toasts = new Map(); // id -> { el, timeoutId, showTimerId, lane, type, className, pendingOptions }
    this._nextId = 1;
  }

  load() {
    const appContainer = document.getElementById('app') || document.body;

    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = this.containerId;
      appContainer.appendChild(this.container);
    }

    this.formContainer = document.getElementById(this.formContainerId);
    if (!this.formContainer) {
      this.formContainer = document.createElement('div');
      this.formContainer.id = this.formContainerId;
      appContainer.appendChild(this.formContainer);
    }

    this._configureContainer(this.container, 'ephemeral');
    this._configureContainer(this.formContainer, 'form');
  }

  show({ title, message, type = 'info', timeoutMs, id, dismissible = true, delayMs = 0, allowHtml = false, className = '' } = {}) {
    const toastId = id || `t${this._nextId++}`;

    // If already exists, update instead.
    if (this._toasts.has(toastId)) {
      this.update(toastId, { title, message, type, timeoutMs, dismissible, allowHtml, className });
      return toastId;
    }

    const nextType = this._normalizeType(type);
    const nextClassName = this._normalizeClassName(className);
    const lane = this._getLaneForClassName(nextClassName);
    const options = { title, message, type: nextType, timeoutMs, dismissible, allowHtml, className: nextClassName };

    const create = () => {
      const el = document.createElement('div');
      el.className = this._buildNotificationClassName(nextType, nextClassName);
      el.setAttribute('data-toast-id', toastId);
      el.setAttribute('role', nextType === 'error' ? 'alert' : 'status');

      const icon = nextType === 'loading' ? '<span class="spinner"></span>' : (TOAST_ICONS[nextType] || TOAST_ICONS.info);
      el.innerHTML = `
        <div class="notification-icon" aria-hidden="true">${icon}</div>
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

      this._insertToast(el, lane);
      // Trigger entry animation (match lib-lp-staking-frontend style).
      requestAnimationFrame(() => el.classList.add('show'));

      const rec = { el, timeoutId: null, showTimerId: null, lane, type: nextType, className: nextClassName, pendingOptions: null };
      this._toasts.set(toastId, rec);

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        rec.timeoutId = window.setTimeout(() => this.dismiss(toastId), timeoutMs);
      }
    };

    if (delayMs && delayMs > 0) {
      const showTimerId = window.setTimeout(create, delayMs);
      this._toasts.set(toastId, {
        el: null,
        timeoutId: null,
        showTimerId,
        lane,
        type: nextType,
        className: nextClassName,
        pendingOptions: options,
      });
    } else {
      create();
    }

    return toastId;
  }

  loading(message, { title = 'Loading', id, delayMs = 200, allowHtml = false } = {}) {
    return this.show({ id, title, message, type: 'loading', timeoutMs: 0, dismissible: true, delayMs, allowHtml });
  }

  success(message, { title = 'Done', timeoutMs = 2500, id, allowHtml = false } = {}) {
    return this.show({ id, title, message, type: 'success', timeoutMs, dismissible: true, allowHtml });
  }

  error(message, { title = 'Error', timeoutMs = 0, id, allowHtml = false } = {}) {
    // Error toasts stay until user dismisses them (timeoutMs = 0 means no auto-dismiss)
    return this.show({ id, title, message, type: 'error', timeoutMs, dismissible: true, allowHtml });
  }

  update(id, { title, message, type, timeoutMs, dismissible, allowHtml, className } = {}) {
    const rec = this._toasts.get(id);
    if (!rec) return false;

    // If pending delayed show, cancel and show immediately with updated content.
    if (!rec.el && rec.showTimerId) {
      window.clearTimeout(rec.showTimerId);
      this._toasts.delete(id);
      const pending = rec.pendingOptions || {};
      this.show({
        id,
        title: title !== undefined ? title : pending.title,
        message: message !== undefined ? message : pending.message,
        type: type !== undefined ? type : pending.type,
        timeoutMs: timeoutMs !== undefined ? timeoutMs : pending.timeoutMs,
        dismissible: dismissible !== undefined ? dismissible : pending.dismissible,
        delayMs: 0,
        allowHtml: allowHtml !== undefined ? allowHtml : pending.allowHtml,
        className: className !== undefined ? className : pending.className,
      });
      return true;
    }

    const el = rec.el;
    if (!el) return false;

    if (type !== undefined || className !== undefined) {
      const nextType = type !== undefined ? this._normalizeType(type) : rec.type;
      const nextClassName = className !== undefined ? this._normalizeClassName(className) : rec.className;
      const nextLane = this._getLaneForClassName(nextClassName);
      const hasShow = el.classList.contains('show');
      el.className = this._buildNotificationClassName(nextType, nextClassName, { includeShow: hasShow });
      el.setAttribute('role', nextType === 'error' ? 'alert' : 'status');
      const iconEl = el.querySelector('.notification-icon');
      this._setToastIcon(iconEl, nextType);

      if (rec.lane !== nextLane) {
        this._insertToast(el, nextLane);
      }

      rec.type = nextType;
      rec.className = nextClassName;
      rec.lane = nextLane;
    }
    if (typeof title === 'string') {
      let titleEl = el.querySelector('.notification-title');
      if (!titleEl) {
        const contentEl = el.querySelector('.notification-content');
        if (contentEl) {
          titleEl = document.createElement('div');
          titleEl.className = 'notification-title';
          contentEl.prepend(titleEl);
        }
      }
      if (titleEl) titleEl.textContent = title;
    }
    if (typeof message === 'string') {
      const msgEl = el.querySelector('.notification-message');
      const shouldAllowHtml = typeof allowHtml === 'boolean' ? allowHtml : false;
      if (msgEl) {
        if (shouldAllowHtml) {
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

  _configureContainer(container, lane) {
    if (!container) return;

    container.classList.add('notification-container');
    container.classList.remove('notification-container--ephemeral', 'notification-container--form');
    container.classList.add(`notification-container--${lane}`);
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-relevant', 'additions');
  }

  _normalizeType(type) {
    const value = String(type || '').trim();
    return TOAST_TYPES.has(value) ? value : 'info';
  }

  _normalizeClassName(className) {
    return String(className || '').trim().replace(/\s+/g, ' ');
  }

  _getLaneForClassName(className) {
    if (!className) return 'ephemeral';
    const classes = className.split(' ').filter(Boolean);
    return classes.includes(FORM_TOAST_CLASS) ? 'form' : 'ephemeral';
  }

  _buildNotificationClassName(type, className, { includeShow = false } = {}) {
    const classes = ['notification', this._normalizeType(type)];
    if (className) classes.push(...this._normalizeClassName(className).split(' '));
    if (includeShow) classes.push('show');
    return Array.from(new Set(classes)).join(' ');
  }

  _insertToast(el, lane) {
    const target = lane === 'form' ? this.formContainer : this.container;
    if (!target) return;

    if (lane === 'ephemeral') {
      target.prepend(el);
    } else {
      target.appendChild(el);
    }
  }

  _setToastIcon(iconEl, type) {
    if (!iconEl) return;
    const nextType = this._normalizeType(type);
    if (nextType === 'loading') {
      iconEl.innerHTML = '<span class="spinner"></span>';
      return;
    }
    iconEl.textContent = TOAST_ICONS[nextType] || TOAST_ICONS.info;
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
      const allowlisted = new Set(['a', 'br', 'div', 'span', 'label', 'input', 'button', 'select', 'option', 'code']);
      if (!allowlisted.has(tag)) {
        parent.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }

      if (tag === 'br') {
        parent.appendChild(document.createElement('br'));
        return;
      }

      const el = document.createElement(tag);

      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        if (href && !/^javascript:/i.test(href)) {
          el.setAttribute('href', href);
        } else {
          el.setAttribute('href', '#');
        }
        if (node.getAttribute('target') === '_blank') {
          el.setAttribute('target', '_blank');
        }
        el.setAttribute('rel', 'noopener noreferrer');
      }

      const allowedAttrs = new Set([
        'class',
        'id',
        'type',
        'value',
        'placeholder',
        'min',
        'max',
        'step',
        'readonly',
        'disabled',
        'for',
        'name',
        'aria-label',
        'aria-describedby',
      ]);

      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name;
        if (allowedAttrs.has(name) || name.startsWith('data-') || name.startsWith('aria-')) {
          el.setAttribute(name, attr.value);
        }
      }

      if (tag === 'select' || tag === 'div' || tag === 'label' || tag === 'span' || tag === 'a') {
        node.childNodes.forEach((child) => appendSanitized(child, el));
        if (!el.childNodes.length) {
          el.textContent = node.textContent || '';
        }
      } else if (tag === 'button' || tag === 'option' || tag === 'code') {
        el.textContent = node.textContent || '';
      }

      parent.appendChild(el);
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

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { createWalletConnectButton } from "../ui/wallet-connect.js";

const ACCOUNT = "0x24f55B1e86D67ca62146618Ee486AA4DF611CDD4";
const WALLET_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

let originalDocument;

class TestTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.className = "";
    this.id = "";
    this.type = "";
    this._textContent = "";
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map((child) => child.textContent || "").join("");
    }
    return this._textContent;
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value);
  }

  append(...nodes) {
    for (const node of nodes.flat()) {
      this.children.push(node);
      node.parentNode = this;
    }
    this._textContent = "";
  }

  prepend(...nodes) {
    for (const node of nodes.flat().reverse()) {
      this.children.unshift(node);
      node.parentNode = this;
    }
    this._textContent = "";
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = "";
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(event, handler) {
    const handlers = this.listeners.get(event) || new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  async dispatchEvent(event) {
    event.target ||= this;
    const handlers = [...(this.listeners.get(event.type) || [])];
    await Promise.all(handlers.map((handler) => handler(event)));
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child instanceof TestElement && child.contains(node));
  }

  focus() {}
}

class TestDocument {
  constructor() {
    this.head = new TestElement("head");
    this.body = new TestElement("body");
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new TestElement(tagName);
  }

  createTextNode(text) {
    return new TestTextNode(text);
  }

  getElementById(id) {
    return this.#findById(this.head, id) || this.#findById(this.body, id);
  }

  addEventListener(event, handler) {
    const handlers = this.listeners.get(event) || new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  #findById(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
      if (child instanceof TestElement) {
        const match = this.#findById(child, id);
        if (match) return match;
      }
    }
    return null;
  }
}

function createMockWalletCore() {
  let state = {
    account: null,
    selectedWalletName: null,
    sessionWalletId: null,
  };
  const subscribers = new Set();
  const wallet = {
    id: "legacy:default",
    source: "legacy",
    info: {
      name: "MetaMask",
      rdns: "io.metamask",
      icon: WALLET_ICON,
    },
  };

  function notify(event) {
    subscribers.forEach((subscriber) => subscriber(event, state));
  }

  return {
    getState() {
      return { ...state };
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    async sync() {
      return state;
    },
    async discoverWallets() {
      return [wallet];
    },
    async connect({ walletId }) {
      assert.equal(walletId, wallet.id);
      state = {
        ...state,
        account: ACCOUNT,
        selectedWalletName: wallet.info.name,
        sessionWalletId: wallet.id,
      };
      notify("connected");
      return ACCOUNT;
    },
    async disconnect() {
      state = {
        account: null,
        selectedWalletName: null,
        sessionWalletId: null,
      };
      notify("disconnected");
    },
  };
}

beforeEach(() => {
  originalDocument = globalThis.document;
  globalThis.document = new TestDocument();
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
});

test("wallet connect UI renders a button and wallet dropdown", async () => {
  const target = document.createElement("div");
  const control = createWalletConnectButton({
    target,
    walletCore: createMockWalletCore(),
  });

  const [button, menu] = control.element.children;

  assert.equal(button.textContent, "Connect Wallet");
  assert.equal(menu.hidden, true);

  await control.open();

  assert.equal(menu.hidden, false);
  assert.match(menu.textContent, /Select Wallet/);
  assert.match(menu.textContent, /MetaMask/);

  control.destroy();
});

test("wallet connect UI renders wallet logo images next to wallet names", async () => {
  const target = document.createElement("div");
  const control = createWalletConnectButton({
    target,
    walletCore: createMockWalletCore(),
  });
  const [, menu] = control.element.children;

  await control.open();
  const walletOption = menu.children.find((child) => child.dataset?.walletId === "legacy:default");
  const icon = walletOption.children[0];
  const image = icon.children.find((child) => child.tagName === "IMG");

  assert.equal(image.src, WALLET_ICON);
  assert.equal(image.hidden, true);

  control.destroy();
});

test("wallet connect UI shows only the shortened address after connect", async () => {
  const target = document.createElement("div");
  const control = createWalletConnectButton({
    target,
    walletCore: createMockWalletCore(),
  });
  const [button, menu] = control.element.children;

  await control.open();
  const walletOption = menu.children.find((child) => child.dataset?.walletId === "legacy:default");
  await walletOption.dispatchEvent({ type: "click" });

  assert.match(button.textContent, /0x24f5\.\.\.CDD4/);
  assert.doesNotMatch(button.textContent, /MetaMask/);

  control.destroy();
});

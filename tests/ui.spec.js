import { test, expect } from '@playwright/test';

const MOCK_ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const MOCK_WITHDRAW_ACCOUNT = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const CHAIN_ID_HEX = '0x7a69';
const MOCK_TOKEN_ADDRESS = process.env.MOCK_TOKEN_ADDRESS;

const installMockProvider = ({ mockAccount, chainIdHex }) => {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return chainIdHex;
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [mockAccount];
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'wallet_addEthereumChain') return null;

      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      });

      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || 'RPC error');
      return json.result;
    },
    on: () => {},
    removeListener: () => {},
  };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installMockProvider, {
    mockAccount: MOCK_ACCOUNT,
    chainIdHex: CHAIN_ID_HEX,
  });
});

const newPageForAccount = async (browser, account) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(installMockProvider, {
    mockAccount: account,
    chainIdHex: CHAIN_ID_HEX,
  });
  return { context, page };
};

const connectWallet = async (page) => {
  await page.waitForFunction(() => window.walletManager?.connectMetaMask);
  await page.evaluate(async () => {
    await window.walletManager.connectMetaMask();
  });
  await page.waitForFunction(() => window.walletManager?.isConnected?.());
};

const reloadAndReconnect = async (page) => {
  await page.reload();
  await connectWallet(page);
};

const createLock = async (page, { token, amount, cliffDays, durationDays, withdrawAddress } = {}) => {
  await page.locator('#open-lock-action-btn').click();
  const toast = page.locator('[data-toast-id="lock-form-toast"]');
  await expect(toast).toBeVisible();
  await toast.locator('[data-lock-token]').fill(token);
  await toast.locator('[data-lock-amount]').fill(String(amount));
  await toast.locator('[data-lock-cliff]').fill(String(cliffDays));
  await toast.locator('[data-lock-duration]').fill(String(durationDays));
  if (withdrawAddress) {
    await toast.locator('[data-lock-withdraw]').fill(withdrawAddress);
  }
  await toast.locator('[data-lock-submit]').click();
  await expect(page.getByText('Lock confirmed.')).toBeVisible();
  const lockId = await page.evaluate(async () => {
    const next = await window.contractManager.getNextLockId();
    return Number(next) - 1;
  });
  return lockId;
};

const unlockLock = async (page, lockId) => {
  await page.evaluate((id) => {
    window.lockActionToasts?.openUnlockToast?.({ lockId: id });
  }, lockId);
  await page.locator('[data-toast-id="unlock-form-toast"] [data-unlock-submit]').click();
  await expect(page.getByText('Unlock confirmed.')).toBeVisible();
};

const advanceTime = async (page, seconds) => {
  await page.evaluate(async (delta) => {
    await window.ethereum.request({ method: 'evm_increaseTime', params: [delta] });
    await window.ethereum.request({ method: 'evm_mine', params: [] });
  }, seconds);
};

const withdrawPercent = async (page, lockId, percent) => {
  await page.evaluate(
    ({ id }) => window.lockActionToasts?.openWithdrawToast?.({ lockId: id }),
    { id: lockId }
  );
  await page.locator('[data-toast-id="withdraw-form-toast"] [data-withdraw-percent]').fill(String(percent));
  await page.locator('[data-toast-id="withdraw-form-toast"] [data-withdraw-submit]').click();
  await expect(page.getByText('Withdrawal confirmed.')).toBeVisible();
};

const withdrawAmount = async (page, lockId, amount) => {
  await page.evaluate(
    ({ id }) => window.lockActionToasts?.openWithdrawToast?.({ lockId: id }),
    { id: lockId }
  );
  await page.locator('[data-toast-id="withdraw-form-toast"] [data-withdraw-amount]').fill(String(amount));
  await page.locator('[data-toast-id="withdraw-form-toast"] [data-withdraw-submit]').click();
  await expect(page.getByText('Withdrawal confirmed.')).toBeVisible();
};

test('renders primary tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: /Active/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /History/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Parameters/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
});

test('history tab loads on demand', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: 'Load history' })).toBeVisible();
  const status = page.locator('[data-history-status]');
  await expect(status).toHaveText('');

  await page.getByRole('button', { name: 'Load history' }).click();
  await expect(status).not.toHaveText('');
});

test('create lock, withdraw, and see it in history', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 1000,
    cliffDays: 0,
    durationDays: 1,
  });

  await page.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  await expect(page.getByText(`Lock #${lockId}`)).toBeVisible();

  await unlockLock(page, lockId);
  await advanceTime(page, 2 * 24 * 60 * 60);
  await withdrawPercent(page, lockId, 100);

  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Load history' }).click();
  const historyList = page.locator('[data-history-list]');
  await expect(historyList.getByText(`Lock #${lockId}`)).toBeVisible();
  await expect(historyList.locator('.card').first()).toContainText('Withdrawn');
});

test('lock with custom withdraw address hides withdraw action', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 500,
    cliffDays: 0,
    durationDays: 2,
    withdrawAddress: MOCK_WITHDRAW_ACCOUNT,
  });

  await page.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  const card = page.locator('.lock-card', { hasText: `Lock #${lockId}` });
  await expect(card.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
});

test('action buttons are gated by connected address', async ({ browser }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  const { context: creatorContext, page: creatorPage } = await newPageForAccount(browser, MOCK_ACCOUNT);
  await creatorPage.goto('/');
  await connectWallet(creatorPage);

  const lockId = await createLock(creatorPage, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 777,
    cliffDays: 0,
    durationDays: 3,
    withdrawAddress: MOCK_WITHDRAW_ACCOUNT,
  });

  // Reload clears any in-page RPC caches and ensures Active Locks re-queries chain state.
  await reloadAndReconnect(creatorPage);
  await creatorPage.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  await creatorPage.locator('[data-overview-refresh]').click();
  await expect(creatorPage.getByText(`Lock #${lockId}`)).toBeVisible();
  const creatorCard = creatorPage.locator('.lock-card', { hasText: `Lock #${lockId}` });
  await expect(creatorCard.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await expect(creatorCard.getByRole('button', { name: 'Retract' })).toBeVisible();
  await expect(creatorCard.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  await creatorContext.close();

  const { context: withdrawContext, page: withdrawPage } = await newPageForAccount(browser, MOCK_WITHDRAW_ACCOUNT);
  await withdrawPage.goto('/');
  await connectWallet(withdrawPage);

  await withdrawPage.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  await withdrawPage.locator('[data-overview-refresh]').click();
  await expect(withdrawPage.getByText(`Lock #${lockId}`)).toBeVisible();
  const withdrawCard = withdrawPage.locator('.lock-card', { hasText: `Lock #${lockId}` });
  await expect(withdrawCard.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
  await expect(withdrawCard.getByRole('button', { name: 'Retract' })).toHaveCount(0);
  const withdrawBtn = withdrawCard.getByRole('button', { name: 'Withdraw' });
  await expect(withdrawBtn).toBeVisible();
  await expect(withdrawBtn).toHaveAttribute('aria-disabled', 'true');
  await withdrawContext.close();
});

test('cliff prevents withdraw before it ends', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 800,
    cliffDays: 2,
    durationDays: 4,
  });

  await unlockLock(page, lockId);
  const unlockTime = await page.evaluate(async (id) => {
    const lock = await window.contractManager.getLock(id);
    return Number(lock.unlockTime?.toString?.() ?? lock.unlockTime ?? 0);
  }, lockId);

  // Reloading resets the in-page read-only RPC cache and OverviewTab state.
  await reloadAndReconnect(page);

  // Align UI time with the chain's unlockTime so cliff gating is deterministic even under Hardhat time travel.
  const fakeNowMs = (unlockTime + 24 * 60 * 60) * 1000;
  await page.evaluate((ts) => {
    Date.now = () => ts;
  }, fakeNowMs);

  await page.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  await page.locator('[data-overview-refresh]').click();
  await page.waitForFunction((id) => {
    return !!window.overviewTab?._lockIndex?.get?.(Number(id));
  }, lockId);

  await page.evaluate((id) => {
    window.overviewTab?._openWithdrawToast?.(id);
  }, lockId);

  await expect(page.getByText('Action unavailable')).toBeVisible();
  await expect(page.getByText('Cliff period is active. Withdrawals start after the cliff ends.')).toBeVisible();
});

test('partial withdrawal by percent updates withdrawn amount', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 1000,
    cliffDays: 0,
    durationDays: 4,
  });

  await unlockLock(page, lockId);
  await advanceTime(page, 2 * 24 * 60 * 60);
  // Reload clears the in-page RPC cache, so OverviewTab's primed "available" should reflect the time-warped chain.
  await reloadAndReconnect(page);
  await page.getByRole('tab', { name: 'Active Locks', exact: true }).click();
  await page.locator('[data-overview-refresh]').click();

  await page.waitForFunction((id) => {
    const entry = window.overviewTab?._locks?.find?.((item) => item.id === Number(id));
    if (!entry) return false;
    try {
      return window.ethers.BigNumber.from(entry.available ?? 0).gt(0);
    } catch {
      return false;
    }
  }, lockId);
  await withdrawPercent(page, lockId, 25);

  const withdrawnOk = await page.evaluate(async (id) => {
    const lock = await window.contractManager.getLock(id);
    const amount = window.ethers.BigNumber.from(lock.amount);
    const withdrawn = window.ethers.BigNumber.from(lock.withdrawn);
    return withdrawn.gt(0) && withdrawn.lt(amount);
  }, lockId);
  expect(withdrawnOk).toBeTruthy();
});

test('withdraw exact amount updates withdrawn', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 1000,
    cliffDays: 0,
    durationDays: 10,
  });

  await unlockLock(page, lockId);
  await advanceTime(page, 2 * 24 * 60 * 60);

  const { amountStr, expected } = await page.evaluate(async (id) => {
    const available = await window.contractManager.previewWithdrawable(id);
    const half = window.ethers.BigNumber.from(available).div(2);
    return {
      amountStr: window.ethers.utils.formatUnits(half, 18),
      expected: half.toString(),
    };
  }, lockId);

  await withdrawAmount(page, lockId, amountStr);

  const withdrawnOk = await page.evaluate(async ({ id, expectedRaw }) => {
    const lock = await window.contractManager.getLock(id);
    const withdrawn = window.ethers.BigNumber.from(lock.withdrawn);
    const expected = window.ethers.BigNumber.from(expectedRaw);
    const total = window.ethers.BigNumber.from(lock.amount);
    return withdrawn.gte(expected) && withdrawn.lt(total);
  }, { id: lockId, expectedRaw: expected });
  expect(withdrawnOk).toBeTruthy();
});

test('retract removes lock and shows in history', async ({ page }) => {
  if (!MOCK_TOKEN_ADDRESS) throw new Error('MOCK_TOKEN_ADDRESS env var missing');

  await page.goto('/');
  await connectWallet(page);

  const lockId = await createLock(page, {
    token: MOCK_TOKEN_ADDRESS,
    amount: 600,
    cliffDays: 0,
    durationDays: 5,
  });

  await page.evaluate((id) => {
    window.lockActionToasts?.openRetractToast?.({ lockId: id });
  }, lockId);
  await page.locator('[data-toast-id="retract-form-toast"] [data-retract-submit]').click();
  await expect(page.getByText('Retract confirmed.')).toBeVisible();

  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Load history' }).click();
  const historyList = page.locator('[data-history-list]');
  await expect(historyList.getByText(`Lock #${lockId}`)).toBeVisible();
  await expect(historyList.locator('.card').first()).toContainText('Retracted');
});

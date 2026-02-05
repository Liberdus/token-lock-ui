# UI Test Setup (Playwright + Mock MetaMask)

This UI repo is now a Node project and ships Playwright tests that mock MetaMask.

## Prereqs
- Node.js
- Clone the `token-lock-contract` repo so it sits next to this repo:
  - `../token-lock-contract`
  - https://github.com/Liberdus/token-lock-contract
  - ```bash
    git clone https://github.com/Liberdus/token-lock-contract ../token-lock-contract
    ```

## Run Tests (Automated)
From `token-lock-ui`:
```bash
npm install
npm run test:e2e
```

## Run Headed (Watch the Browser)
From `token-lock-ui`:
```bash
npm run test:e2e -- --headed --project=chromium
```

Optional slow motion:
```bash
npm run test:e2e -- --headed --project=chromium --slow-mo=250
```

What this does:
1. Starts a local Hardhat node in `token-lock-contract`
2. Compiles and deploys TokenLock to the local node
3. Starts a local static server that proxies JSON-RPC
4. Runs Playwright tests with a mocked `window.ethereum`

## Notes
- The mock provider exposes one account: `0xf39f...2266` (Hardhat default #0).
- The static server serves a test `js/config.js` that targets the local chain.
- No real MetaMask is required for tests.

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
npx playwright install
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

## Manual Hardhat Testing With Live Server
Use a fresh Hardhat node so the deterministic deployment addresses match `js/config.js`.

Terminal 1:
```bash
cd ../token-lock-contract
npx hardhat node --hostname 127.0.0.1 --port 8545
```

Terminal 2:
```bash
node scripts/deploy-local.js
```

Then open the UI through VS Code Live Server with:
```text
?env=hardhat
```

MetaMask must use chain ID `31337` (`0x7a69`) for `http://127.0.0.1:8545`.
If MetaMask already has that RPC saved as chain ID `1337`, edit or remove that network first; MetaMask will not add a second network with the same RPC URL and a different chain ID.

Use the deployed `mockToken` address from `node scripts/deploy-local.js` as the token address in the lock form.

## Notes
- The mock provider exposes one account: `0xf39f...2266` (Hardhat default #0).
- The static server serves a test `js/config.js` that targets the local chain.
- No real MetaMask is required for tests.

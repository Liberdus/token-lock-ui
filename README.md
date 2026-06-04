# Token Lock UI

Simple UI for the Liberdus TokenLock contract. Uses the Liberdus reference frontend styling.

## Quick Start

Use any static server (ES modules require HTTP, not `file://`).

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/Liberdus/token-lock-ui.git
cd token-lock-ui
python3 -m http.server 8080
```

If the repo is already cloned:

```bash
git submodule update --init --recursive
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Network + Contract
All site/network/contract values are configured in `js/config.js`.

The app resolves an environment from `SITE_ENVIRONMENTS`, or from `?env=bnbtestnet`, `?env=bnbmainnet`, `?env=amoy`, or `?env=hardhat`.
Current environments:
- `bnbtestnet`: BNB Smart Chain Testnet, contract `0xd77C46da1726cAEC98f10dE9f3e8fF9578608411`
- `bnbmainnet`: BNB Smart Chain, contract address to be filled after mainnet deployment
- `amoy`: Polygon Amoy, contract `0xDBe4d7479E2cc3Fa691Ede0D98374Cb1347B43F7`
- `hardhat`: Local Hardhat, deterministic contract `0x5FbDB2315678afecb367f032d93F642f64180aa3`

## ABI
Update `abi.json` if the contract changes.

## Notes
- Requires MetaMask for write actions.
- Lock amounts are in token units; inputs are converted using token decimals.
- `ratePerDay` uses `RATE_SCALE = 1e12`.

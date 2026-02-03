# Token Lock UI

Simple UI for the Liberdus TokenLock contract. Uses the Liberdus reference frontend styling.

## Quick Start
```bash
python3 -m http.server 8080
```
Open `http://localhost:8080`.

## Network + Contract
Configured in `js/config.js`:
- Network: Polygon Amoy (chain ID 80002)
- Contract: `0xdD8568f15F2B1146aD05bBfB07240760c25f6162`

## ABI
Update `abi.json` if the contract changes.

## Notes
- Requires MetaMask for write actions.
- Lock amounts are in token units; inputs are converted using token decimals.
- `ratePerDay` uses `RATE_SCALE = 1e12`.

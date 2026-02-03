# Contract Replacement Notes

This UI is already wired to the TokenLock contract on Polygon Amoy.

If you redeploy:
1. Update `js/config.js` with the new contract address.
2. Replace `abi.json` with the new ABI.
3. Verify the contract on Polygonscan for the read/write UI.

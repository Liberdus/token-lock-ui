# Contract Replacement Notes

Network and contract details live in `js/config.js`.

If you deploy or redeploy:
1. Update the matching environment in `js/config.js` with the contract address.
2. Replace `abi.json` with the new ABI.
3. Update `DEPLOYMENT_BLOCK` to the deployment block so history scans stay fast.
4. Add the test/prod hostnames to `SITE_ENVIRONMENTS`.
5. Verify the contract on the configured block explorer for the read/write UI.

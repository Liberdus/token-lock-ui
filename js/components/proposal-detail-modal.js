import { CONFIG } from '../config.js';
import { formatTxMessage, extractErrorMessage, normalizeErrorMessage, formatSignatureError } from '../utils/transaction-helpers.js';

export class ProposalDetailModal {
  constructor() {
    this.container = null;
    this.backdrop = null;
    this.modal = null;
    this.closeBtn = null;
    this.signBtn = null;
    this.bodyEl = null;

    this.current = null; // { event, details, requiredSignatures }
  }

  load() {
    this._ensureDom();
  }

  _ensureDom() {
    this.container = document.getElementById('modal-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'modal-container';
      document.body.appendChild(this.container);
    }

    this.container.innerHTML = `
      <div class="modal-backdrop hidden" data-proposal-modal-backdrop>
        <div class="modal" role="dialog" aria-label="Proposal details" aria-modal="true">
          <div class="modal-header">
            <div class="modal-title">Proposal Details</div>
            <button type="button" class="btn btn--ghost" data-proposal-modal-close>Close</button>
          </div>
          <div class="modal-body" data-proposal-modal-body></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--primary" data-proposal-modal-sign data-requires-tx="true">
              Sign
            </button>
            <button type="button" class="btn" data-proposal-modal-close-2>Close</button>
          </div>
        </div>
      </div>
    `;

    this.backdrop = this.container.querySelector('[data-proposal-modal-backdrop]');
    this.modal = this.container.querySelector('.modal');
    this.closeBtn = this.container.querySelector('[data-proposal-modal-close]');
    this.signBtn = this.container.querySelector('[data-proposal-modal-sign]');
    this.bodyEl = this.container.querySelector('[data-proposal-modal-body]');

    this.closeBtn?.addEventListener('click', () => this.close());
    this.container.querySelector('[data-proposal-modal-close-2]')?.addEventListener('click', () => this.close());

    this.backdrop?.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.signBtn?.addEventListener('click', () => this.onSign());

    // escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.backdrop?.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  async open({ event, requiredSignatures }) {
    if (!event?.operationId) return;

    // Refresh on-chain details for this opId
    const contractManager = window.contractManager;
    
    // Ensure parameters are loaded (needed for getMintAmount() to fix corrupted cache values)
    await contractManager.getParametersBatch?.().catch(() => {});
    
    const detailsMap = await contractManager.getOperationsBatch([event.operationId]);
    const details = detailsMap.get(event.operationId) || null;

    this.current = { event, details, requiredSignatures };
    this.render();

    this.backdrop?.classList.remove('hidden');

    // gate sign button
    window.networkManager?.updateUIState?.();
    this._updateSignButtonState();
  }

  close() {
    this.backdrop?.classList.add('hidden');
    this.current = null;
  }

  async onSign() {
    if (!this.current?.event?.operationId) return;
    const opId = this.current.event.operationId;

    const toast = window.toastManager;
    const contractManager = window.contractManager;
    const walletManager = window.walletManager;
    const networkManager = window.networkManager;

    if (!networkManager?.isTxEnabled?.()) {
      toast?.error?.('Connect MetaMask on Polygon to sign.');
      return;
    }

    const read = contractManager.getReadContract();
    const write = contractManager.getWriteContract();
    const signer = walletManager?.getSigner?.();
    const address = walletManager?.getAddress?.();

    if (!read || !write || !signer) {
      toast?.error?.('Wallet/signing not ready.');
      return;
    }

    // Optional: signer check (avoids obvious revert)
    try {
      const isSigner = await read.isSigner(address);
      if (!isSigner) {
        toast?.error?.('This wallet is not a signer for this contract.');
        return;
      }
    } catch {
      // ignore; contract will revert if not allowed
    }

    // prevent signing executed/expired ops
    if (this.current.details?.executed) {
      toast?.error?.('This operation is already executed.');
      return;
    }
    if (this.current.details?.expired) {
      toast?.error?.('This operation is expired.');
      return;
    }

    this.signBtn.disabled = true;
    this.signBtn.textContent = 'Signing…';

    const signingId = toast?.loading?.('Signing proposal…', { id: 'proposal-sign', delayMs: 100 });
    let confirmationId = null;
    let confirmationUpdated = false; // Track if confirmation toast was updated to success/error

    try {
      const hash = await read.getOperationHash(opId);
      const sig = await signer.signMessage(window.ethers.utils.arrayify(hash));
      const tx = await write.submitSignature(opId, sig);

      // Dismiss signing toast and show confirmation toast
      toast?.dismiss?.(signingId);
      confirmationId = toast?.loading?.('Waiting for confirmation…', { id: 'proposal-sign-confirm', title: 'Confirming', delayMs: 0 });
      
      // Update button text to "Confirming…" while waiting for confirmation
      this.signBtn.textContent = 'Confirming…';

      await tx.wait();
      contractManager?.invalidateParametersCache?.({ notify: true });

      // Refresh details in modal
      const detailsMap = await contractManager.getOperationsBatch([opId]);
      this.current.details = detailsMap.get(opId) || this.current.details;
      this.render();

      // Notify list to refresh row
      document.dispatchEvent(new CustomEvent('proposalSigned', { detail: { operationId: opId } }));

      // Dismiss confirmation toast and create a fresh success toast to ensure it's visible
      if (confirmationId) {
        toast?.dismiss?.(confirmationId);
      }
      
      // Format message with clickable transaction hash link on its own line
      const message = formatTxMessage(tx.hash);
      
      // Create success toast (user must dismiss manually)
      toast?.success?.(message, {
        title: 'Signature submitted',
        id: 'proposal-sign-success',
        timeoutMs: 0, // User must dismiss manually
        allowHtml: true,
      });
      confirmationUpdated = true;
    } catch (e) {
      // Dismiss any loading toasts first
      if (signingId) {
        toast?.dismiss?.(signingId);
      }
      if (confirmationId) {
        toast?.dismiss?.(confirmationId);
      }
      
      // Extract and normalize error message
      let errorMessage = extractErrorMessage(e, 'Failed to submit signature');
      errorMessage = normalizeErrorMessage(errorMessage);
      
      // Detect "Signature already submitted" and show user-friendly message
      const { title: errorTitle, message: errorMsg } = formatSignatureError(errorMessage);
      
      // Create a dedicated error toast that will persist
      const errorId = 'proposal-sign-error';
      toast?.error?.(errorMsg, {
        title: errorTitle,
        id: errorId,
        timeoutMs: 0, // Errors persist until user dismisses
      });
      confirmationUpdated = true;
    } finally {
      // Dismiss confirmation toast if it's still in loading state (button re-enabled)
      // Success/error toasts will remain visible
      if (confirmationId && !confirmationUpdated) {
        toast?.dismiss?.(confirmationId);
      }
      this.signBtn.textContent = 'Sign';
      this.signBtn.disabled = false;
      this._updateSignButtonState();
    }
  }

  _updateSignButtonState() {
    if (!this.signBtn) return;
    const txEnabled = !!window.networkManager?.isTxEnabled?.();
    const executed = !!this.current?.details?.executed;
    const expired = !!this.current?.details?.expired;
    this.signBtn.disabled = !txEnabled || executed || expired;
  }

  render() {
    if (!this.bodyEl) return;
    if (!this.current) {
      this.bodyEl.innerHTML = '';
      return;
    }

    const { event, details, requiredSignatures } = this.current;
    const opType = details?.opType ?? event?.opType ?? null;
    const typeLabel = operationEnumToString(opType);
    const ts = Number(event?.timestamp || 0);
    const proposedAt = ts ? new Date(ts * 1000).toLocaleString() : '';
    const deadline = details?.deadline ? new Date(details.deadline * 1000).toLocaleString() : '';
    const executed = details?.executed ? 'Yes' : 'No';
    const expired = details?.expired ? 'Yes' : 'No';

    const rawValue = details?.value ?? event?.value;
    const valueDisplay = formatValueForOpType(opType, rawValue);
    const dataDisplay = formatDataForOpType(opType, details?.data ?? event?.data);

    const required = opType === 7 ? 2 : (requiredSignatures ?? '?');
    const sigs = typeof details?.numSignatures === 'number' ? `${details.numSignatures}/${required}` : '';

    this.bodyEl.innerHTML = `
      <div class="kv-grid">
        <div class="kv">
          <div class="kv-label">Operation ID</div>
          <div class="kv-value"><code>${event.operationId}</code></div>
        </div>
        <div class="kv">
          <div class="kv-label">Type</div>
          <div class="kv-value">${typeLabel}</div>
        </div>
        <div class="kv">
          <div class="kv-label">Proposed By</div>
          <div class="kv-value"><code>${event.requester || ''}</code></div>
        </div>
        <div class="kv">
          <div class="kv-label">Proposed At</div>
          <div class="kv-value">${proposedAt}</div>
        </div>

        <div class="kv">
          <div class="kv-label">Target</div>
          <div class="kv-value"><code>${details?.target ?? event?.target ?? ''}</code></div>
        </div>
        <div class="kv">
          <div class="kv-label">Value</div>
          <div class="kv-value">${valueDisplay}</div>
        </div>
        <div class="kv kv--full">
          <div class="kv-label">Data</div>
          <div class="kv-value"><code>${escapeHtml(dataDisplay)}</code></div>
        </div>

        <div class="kv">
          <div class="kv-label">Signatures</div>
          <div class="kv-value">${sigs}</div>
        </div>
        <div class="kv">
          <div class="kv-label">Executed</div>
          <div class="kv-value">${executed}</div>
        </div>
        <div class="kv">
          <div class="kv-label">Expired</div>
          <div class="kv-value">${expired}</div>
        </div>
        <div class="kv">
          <div class="kv-label">Deadline</div>
          <div class="kv-value">${deadline}</div>
        </div>
        <div class="kv kv--full">
          <div class="kv-label">Network</div>
          <div class="kv-value">${CONFIG.NETWORK.NAME} (chainId ${CONFIG.NETWORK.CHAIN_ID})</div>
        </div>
      </div>
    `;
  }
}

function operationEnumToString(op) {
  switch (Number(op)) {
    case 0: return 'Mint';
    case 1: return 'Burn';
    case 2: return 'PostLaunch';
    case 3: return 'Pause';
    case 4: return 'Unpause';
    case 5: return 'SetBridgeInCaller';
    case 6: return 'SetBridgeInLimits';
    case 7: return 'UpdateSigner';
    case 8: return 'Distribute';
    default: return 'Unknown';
  }
}

function formatValueForOpType(opType, value) {
  if (value === null || value === undefined) return '';
  const n = Number(opType);

  try {
    // Get token symbol from contract manager (only use if available from contract)
    const contractManager = window.contractManager;
    const symbol = contractManager?.getTokenSymbol?.();
    
    if (n === 0 || n === 1 || n === 8) {
      // Mint (0), Burn (1), Distribute (8) are token amounts (wei)
      
      // IMPORTANT: For Mint operations, the contract ignores the `value` parameter
      // and always uses MINT_AMOUNT constant. The event may have incorrect historical
      // values from old proposals. Always use MINT_AMOUNT from the contract for Mint.
      if (n === 0) {
        const mintAmount = contractManager?.getMintAmount?.();
        if (mintAmount) {
          const formatted = window.ethers.utils.formatEther(mintAmount);
          return symbol ? `${formatted} ${symbol}` : formatted;
        }
        // Fallback to value if MINT_AMOUNT not available
      }
      
      // Ensure we have a BigNumber-compatible value
      // formatEther needs BigNumber or hex string to preserve precision
      let bnValue;
      
      if (window.ethers.BigNumber.isBigNumber(value)) {
        bnValue = value;
      } else if (value && typeof value === 'object' && value.type === 'BigNumber' && value.hex) {
        // Handle serialized BigNumber object {type: 'BigNumber', hex: '0x...'}
        bnValue = window.ethers.BigNumber.from(value.hex);
      } else if (typeof value === 'string') {
        // If it's a string, it might be hex or decimal
        if (value.startsWith('0x')) {
          bnValue = window.ethers.BigNumber.from(value);
        } else {
          // Decimal string - convert to BigNumber
          bnValue = window.ethers.BigNumber.from(value);
        }
      } else if (typeof value === 'number') {
        // JavaScript number - this is problematic for large values and indicates a parsing/caching issue
        // Numbers lose precision for large values, so this shouldn't happen if value is properly stored as BigNumber
        console.warn('Value is a JavaScript number instead of BigNumber. This indicates a parsing or caching issue:', { opType: n, value, valueType: typeof value });
        bnValue = window.ethers.BigNumber.from(value);
      } else {
        // Try to convert whatever it is
        bnValue = window.ethers.BigNumber.from(value);
      }
      
      const formatted = window.ethers.utils.formatEther(bnValue);
      return symbol ? `${formatted} ${symbol}` : formatted;
    }
    if (n === 7) {
      // UpdateSigner: value encodes address in uint256
      const hex = window.ethers.utils.hexZeroPad(window.ethers.utils.hexlify(value), 20);
      return window.ethers.utils.getAddress(hex);
    }
  } catch (e) {
    // Log error for debugging
    console.error('formatValueForOpType error:', e, { opType, value, valueType: typeof value });
    // fallthrough
  }

  return String(value.toString ? value.toString() : value);
}

function formatDataForOpType(opType, data) {
  if (!data) return '';
  const n = Number(opType);
  if (n === 6) {
    // SetBridgeInLimits: data encodes cooldown (uint256)
    try {
      const decoded = window.ethers.utils.defaultAbiCoder.decode(['uint256'], data);
      return decoded?.[0]?.toString?.() || String(decoded);
    } catch {
      return data;
    }
  }
  return data;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


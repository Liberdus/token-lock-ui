import { CONFIG } from '../config.js';

/**
 * Creates a clickable transaction hash link for block explorer
 * @param {string} txHash - Transaction hash
 * @returns {string} HTML string with clickable link
 */
export function formatTxHashLink(txHash) {
  const explorer = CONFIG?.NETWORK?.BLOCK_EXPLORER || 'https://polygonscan.com';
  const txUrl = `${explorer}/tx/${txHash}`;
  return `<a href="${txUrl}" target="_blank" rel="noopener noreferrer">${txHash}</a>`;
}

/**
 * Formats a transaction message with hash link on its own line
 * @param {string} txHash - Transaction hash
 * @param {string} prefix - Optional prefix message (e.g., "Operation requested: {opId}")
 * @returns {string} HTML string with formatted message
 */
export function formatTxMessage(txHash, prefix = '') {
  const txHashLink = formatTxHashLink(txHash);
  if (prefix) {
    return `${prefix}<br><br>Tx:<br>${txHashLink}`;
  }
  return `<br>Tx:<br>${txHashLink}`;
}

/**
 * Extracts error message from nested error structures (handles MetaMask RPC errors and ethers.js errors)
 * @param {Error|object} error - Error object
 * @param {string} defaultMessage - Default message if extraction fails
 * @returns {string} Extracted error message
 */
export function extractErrorMessage(error, defaultMessage = 'An error occurred') {
  if (!error) return defaultMessage;

  // Try multiple paths to extract the actual error message
  if (error?.error?.data?.message) {
    // Nested RPC error: e.error.data.message
    return error.error.data.message;
  }
  if (error?.data?.message) {
    // Direct RPC error: e.data.message
    return error.data.message;
  }
  if (error?.error?.message) {
    // Nested error: e.error.message
    return error.error.message;
  }
  if (error?.message) {
    // Direct error: e.message
    return error.message;
  }
  if (error?.reason) {
    // Ethers.js reason
    return error.reason;
  }

  return defaultMessage;
}

/**
 * Normalizes error message by removing "execution reverted: " prefix and handling user rejections
 * @param {string} message - Raw error message
 * @returns {string} Normalized error message
 */
export function normalizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return message;
  
  // Handle user rejection errors (MetaMask user cancellation)
  // These errors often include JSON transaction data that we want to strip
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('user rejected') || 
      lowerMessage.includes('action_rejected') ||
      lowerMessage.includes('user denied') ||
      message.includes('ACTION_REJECTED')) {
    return 'User rejected the request.';
  }
  
  // Remove JSON transaction data that might be appended to error messages
  // Look for patterns like (action="...", transaction={...}, code=...) and remove them
  // This handles cases where error messages include full transaction details
  message = message.replace(/\s*\(action="[^"]*",\s*transaction=\{.*?\},?\s*code=[^,)]+.*?\).*$/i, '');
  message = message.replace(/\s*\(code=[^,)]+.*?\).*$/i, '');
  
  // Remove "execution reverted: " prefix
  message = message.replace(/^execution reverted:\s*/i, '').trim();
  
  return message;
}

/**
 * Detects if error is "Signature already submitted" and returns user-friendly message
 * @param {string} errorMessage - Error message to check
 * @returns {{title: string, message: string}} Object with title and message
 */
export function formatSignatureError(errorMessage) {
  const lowerMessage = errorMessage.toLowerCase();
  if (lowerMessage.includes('signature already submitted') || 
      lowerMessage.includes('already signed')) {
    return {
      title: 'Already signed',
      message: 'You have already signed this proposal.',
    };
  }
  return {
    title: 'Sign failed',
    message: errorMessage,
  };
}

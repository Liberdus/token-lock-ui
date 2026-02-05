export function getFieldContainer(inputEl) {
  return inputEl?.closest?.('.field') || null;
}

export function setFieldError(inputEl, message) {
  const field = getFieldContainer(inputEl);
  if (!field) return;
  field.classList.add('field--error');
  const msgEl = field.querySelector('.field-message');
  if (msgEl) msgEl.textContent = message || '';
}

export function clearFieldError(inputEl) {
  const field = getFieldContainer(inputEl);
  if (!field) return;
  field.classList.remove('field--error');
  const msgEl = field.querySelector('.field-message');
  if (msgEl) msgEl.textContent = '';
}

export function clearFormErrors(inputs = []) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  list.forEach((inputEl) => clearFieldError(inputEl));
}

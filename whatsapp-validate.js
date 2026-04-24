/**
 * WhatsApp number validation (India): exactly 10 digits, first digit 6–9.
 * Submissions use normalized +91XXXXXXXXXX.
 */

function bindTenDigitPhoneInput(el) {
  if (!el || el.dataset.tenDigitBound === '1') return;
  el.dataset.tenDigitBound = '1';
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('maxlength', '10');
  el.setAttribute('autocomplete', 'tel-national');

  function sanitize() {
    const v = el.value.replace(/\D/g, '').slice(0, 10);
    if (el.value !== v) el.value = v;
  }

  el.addEventListener('input', sanitize);
  el.addEventListener('blur', sanitize);
  el.addEventListener('paste', function (e) {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text') || '';
    el.value = (el.value + paste).replace(/\D/g, '').slice(0, 10);
  });
}

function initTenDigitPhoneInputs() {
  document.querySelectorAll('input[data-ten-digit-phone]').forEach(bindTenDigitPhoneInput);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTenDigitPhoneInputs);
} else {
  initTenDigitPhoneInputs();
}

/**
 * @param {string} raw
 * @returns {{ ok: true, normalized: string } | { ok: false, message: string }}
 */
function validateWhatsAppNumber(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, message: 'Enter your WhatsApp number.' };
  }
  const n = String(raw).replace(/\D/g, '');
  if (n.length !== 10) {
    return {
      ok: false,
      message: 'Enter exactly 10 digits (without country code).'
    };
  }
  if (!/^[6-9]\d{9}$/.test(n)) {
    return { ok: false, message: 'Enter a valid Indian mobile number (starts with 6–9).' };
  }
  return { ok: true, normalized: '+91' + n };
}

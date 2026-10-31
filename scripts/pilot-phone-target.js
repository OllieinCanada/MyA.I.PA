const RETIRED_TEST_PHONES = new Set(['+12494441086', '+12494682588']);

function requirePilotPhone(value, { readOnly = false } = {}) {
  const input = String(value || '').trim();
  const digits = input.replace(/\D/g, '');
  const phone = input.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
  if (!input || !/^\+?[\d\s().-]+$/.test(input) || !/^\+[1-9]\d{9,14}$/.test(phone)) {
    throw new Error('An explicit valid --phone target is required; there is no default pilot number.');
  }
  if (!readOnly && RETIRED_TEST_PHONES.has(phone)) {
    throw new Error(`Test number ending ${phone.slice(-4)} is retired and held pending separate release approval; select an active pilot.`);
  }
  return phone;
}

module.exports = { requirePilotPhone };

import React from "react";

const DEFAULT_SUPPORT_NUMBER = "+12495033301";

export function getSupportNumber(value) {
  const candidate = String(value || process.env.REACT_APP_SUPPORT_PHONE_NUMBER || DEFAULT_SUPPORT_NUMBER).trim();
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : DEFAULT_SUPPORT_NUMBER;
}

export default function CustomerHelpActions({ phone, compact = false }) {
  const supportNumber = getSupportNumber(phone);
  const textBody = encodeURIComponent("Hi My AI PA, I need help with my account.");
  return (
    <aside className={`customer-help-actions${compact ? " is-compact" : ""}`} aria-label="Need help now?">
      <div><strong>Need help now?</strong><span>Call or text us. You do not need to explain everything twice.</span></div>
      <div>
        <a href={`tel:${supportNumber}`}>Call support</a>
        <a href={`sms:${supportNumber}?&body=${textBody}`}>Text support</a>
      </div>
    </aside>
  );
}

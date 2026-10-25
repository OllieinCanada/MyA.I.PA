import React from 'react';

export default function TwilioReceiptHealthPanel({ health }) {
  const status = health?.status || 'unknown';
  const labels = { healthy: 'Worker running', warning: 'Check delayed receipts', critical: 'Recovery needed',
    unknown: 'Not yet confirmed', unavailable: 'Status unavailable' };
  const age = seconds => seconds == null ? 'Not confirmed' : `${seconds} seconds`;
  const metrics = [
    ['Waiting', health?.counts?.pending], ['Processing', health?.counts?.processing],
    ['Completed (retained)', health?.counts?.completed], ['Failed', health?.counts?.failed],
    ['Expired leases', health?.counts?.expiredLeases], ['Oldest waiting', age(health?.oldestPendingAgeSeconds)],
  ];
  return (
    <section className="admin-card admin-receipt-health my-4" aria-label="SMS delivery receipt worker">
      <div className="admin-section-head"><h3>SMS delivery receipt worker</h3><strong>{labels[status] || labels.unknown}</strong></div>
      <p>Read-only processing status. A receipt confirms a provider update, not that the customer read the text.</p>
      <dl className="grid grid-cols-2 gap-3 py-4 md:grid-cols-3">
        {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-bold">{value ?? 'Not confirmed'}</dd></div>)}
      </dl>
      <p>Last successful run: {health?.lastSuccessfulRunAt || 'Not confirmed'}</p>
      <p>Snapshot checked: {health?.checkedAt || 'Not confirmed'}</p>
      <p>Time since successful run: {age(health?.workerAgeSeconds)}</p>
      {health?.lastErrorCode ? <p>Last failure code: {health.lastErrorCode}</p> : null}
      {status !== 'healthy' ? <p>Check the saved receipt and worker logs before recovery. Do not resend a text or submit another signup to clear this warning.</p> : null}
    </section>
  );
}

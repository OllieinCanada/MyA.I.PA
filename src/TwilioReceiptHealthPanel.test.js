import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TwilioReceiptHealthPanel from './TwilioReceiptHealthPanel';
import fs from 'fs';
import path from 'path';

test('admin data loading preserves receipt health and refreshes the snapshot', () => {
  const source = fs.readFileSync(path.join(__dirname, 'AdminDashboard.js'), 'utf8');
  expect(source).toMatch(/twilioReceipts: data.twilioReceipts \|\| null/);
  expect(source).toMatch(/loadLeadHandoffs\(\), loadAttentionInbox\(\)/);
  expect(source).toMatch(/status: 'unavailable', checkedAt: new Date\(\).toISOString\(\)/);
  expect(source).toMatch(/\}, 30000/);
});

test('receipt panel never presents missing health as a healthy empty queue', () => {
  const html = renderToStaticMarkup(<TwilioReceiptHealthPanel />);
  expect(html).toContain('Not yet confirmed');
  expect(html).toContain('Not confirmed');
  expect(html).not.toContain('Worker running');
  expect(html).not.toContain('<button');
});

test('receipt panel shows aggregate backlog, age and last run without customer content', () => {
  const html = renderToStaticMarkup(<TwilioReceiptHealthPanel health={{ status: 'critical',
    counts: { pending: 3, processing: 1, completed: 10, failed: 1, expiredLeases: 0 },
    oldestPendingAgeSeconds: 700, workerAgeSeconds: 601, lastSuccessfulRunAt: '2026-10-24T00:00:00Z',
    lastErrorCode: 'P2028', receipt: { Body: 'PRIVATE_FIXTURE', MessageSid: 'SECRET_SID' } }} />);
  expect(html).toContain('Recovery needed');
  expect(html).toContain('700 seconds');
  expect(html).toContain('2026-10-24T00:00:00Z');
  expect(html).toContain('P2028');
  expect(html).not.toMatch(/PRIVATE_FIXTURE|SECRET_SID/);
  expect(html).not.toContain('<button');
});

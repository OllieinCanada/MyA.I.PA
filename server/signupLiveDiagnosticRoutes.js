'use strict';
function registerLiveDiagnosticRoutes({ app, requireAdmin, isAllowedOrigin, inspect }) {
  app.post('/api/admin/signup-tracker/:attemptId/diagnostics', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-read-only-check'] !== '1'
      || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))
      || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) {
      return res.status(403).json({ error: 'Open the signed-in signup diagnostic panel. No action was run.' });
    }
    if (!/^signup_[a-f0-9]{32}$/.test(req.params.attemptId)) return res.status(400).json({ error: 'Invalid signup reference.' });
    try { res.json({ ok: true, diagnostics: await inspect(req.params.attemptId) }); }
    catch (error) {
      const limited = error.code === 'DIAGNOSTIC_RATE_LIMITED';
      const safe = ['SIGNUP_IDENTITY_CONFLICT','SIGNUP_RESOURCE_SHARED','SAVED_RESOURCE_CONFLICT',
        'EXACT_CONTEXT_UNAVAILABLE','RECEIPT_CONTEXT_MISMATCH','DIAGNOSTIC_EVIDENCE_CHANGED','DIAGNOSTIC_RATE_LIMITED'].includes(error.code);
      res.status(limited ? 429 : safe ? 409 : 503).json({ error: 'Diagnostic evidence could not be verified. Nothing was changed or retried.',
        code: safe ? error.code : 'DIAGNOSTIC_UNAVAILABLE' });
    }
  });
}
module.exports = { registerLiveDiagnosticRoutes };

// Reject before all body parsers, including Stripe's raw-body parser. Size
// limits alone cannot prevent decoder errors after a compressed frame ends.
function rejectCompressedRequests(req, res, next) {
  const encoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
  if (encoding === 'identity') return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(415).json({
    error: 'Compressed request bodies are not supported.',
    code: 'REQUEST_CONTENT_ENCODING_UNSUPPORTED',
  });
}

module.exports = { rejectCompressedRequests };

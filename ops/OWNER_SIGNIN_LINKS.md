# Private one-use My AI PA admin links

This adds a password-free **bearer sign-in link**, not a permanent bypass and
not identity verification. Anyone holding an unused link may redeem it first.
Send it only to the owner in the approved private chat. Normal admin links and
password login are unchanged. Do not place these links in shared/group chats,
Telegram alert templates, screenshots, Git, public issues, analytics or logs.

## Operator issuance after an approved, verified deployment

Use `npm run admin:owner-link` for the no-issuance help. Supply `ADMIN_PASSWORD`
and `ADMIN_SESSION_SECRET` through the existing in-memory Render-env helper,
including optional `ADMIN_TOTP_SECRET`, then explicitly run:

```text
node scripts/create-admin-owner-link.js --issue --confirm=ISSUE_ONE_USE_ADMIN_LINK --tab=signups
```

The script does not load env files, send anything, call a provider, query a
database, or write credentials to disk. Its explicitly requested output URL is
itself an admin credential. Do not redirect that output to release evidence.
Check that the selected Render service is the verified My AI PA backend before
supplying its current credentials. Do not issue a real link while testing.

## Limits and safety

- Fixed API HTTPS host and allowlisted admin tabs; no arbitrary redirect URLs.
- Ten-minute signed lifetime, random 256-bit nonce, purpose-separated signature
  bound to **both** current password and dedicated session secret (32+ chars).
  Password or session-secret rotation invalidates outstanding links. The link
  path never contains a password or a reusable session token.
- Operator-only local issuer. No public/admin-password issuance endpoint.
- If TOTP is enabled, this alternative is unavailable. It never silently skips
  an enabled second factor. The owner must use the normal MFA flow.
- Credential travels in a URL fragment, removed immediately. Isolated page has
  no third-party dependencies, no referrer, no cache, strict nonce CSP, and no
  framing. A link preview/GET alone does not sign in or consume the link. The
  user must tap **Open my admin**; POST requires exact origin, JSON and a custom
  header. This explicit tap also reduces accidental use by link scanners, but
  cannot prevent an active scanner/browser with the private credential.
- Durable unique RuntimeStore receipt is committed **before** the existing
  12-hour Secure/HttpOnly/SameSite cookie is issued. Simultaneous requests and
  restarts do not allow reuse. Receipts contain only hash-of-nonce and timestamps.
  No new schema, privilege, longer session, password reset or other-user change.
- Claim/commit uncertainty, DB failure, missing config, expiry or replay fails
  closed without a cookie or automatic retry. Request a fresh private link;
  a five-second response deadline does not cancel an in-flight database write.
  A late claim can still consume the link, but can never issue a late session.
  Never turn the feature into a reusable query-string secret. Used markers are
  retained; do not delete them while a signed link could still be valid.
- Signing out clears the existing admin session. This does not remotely revoke
  other sessions; it is not a new account/device-management system. Do not claim
  identity-bound access, perpetual sign-in or universal third-party-site access.

## Validation / release boundary

Run `npm run test:admin-owner-links`, the existing backend security suite,
`RUN_ADMIN_OWNER_LINKS_POSTGRES=1 npm run test:admin-owner-links:postgres` only on
the guarded loopback disposable database, and
`npm run test:admin-owner-links:browser` (OpenSSL required for an ephemeral test
certificate). The browser harness uses real HTTPS through an allowlisted
loopback-only proxy, never a public DNS/upstream connection. It does not contact
the real API, frontend, Vapi, Twilio or Telegram, and never mocks session cookies.
It tests Chromium, Firefox and WebKit at two widths.
This is not physical Safari sign-off. CI still runs the normal full gates.

Request fresh exact-head merge approval. This backend-only change needs no new
Pages assets. After deployment, check the public landing page and invalid/replay
denials; any real owner link must be issued separately and kept out of evidence.
The owner opening the final private link is the real-device sign-in check.

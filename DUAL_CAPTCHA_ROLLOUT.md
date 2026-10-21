# Combined signup verification

Google shows its v2 checkbox. Cloudflare uses `appearance: interaction-only`
with automatic execution; its actual widget is never hidden by application CSS.
Both independent proofs are required. Either failure or expiration blocks signup.

## Release configuration

The existing live Cloudflare-only default is deliberately unchanged until a
coordinated deployment is authorized. Do not change the live backend provider
while the public frontend still submits Cloudflare-only requests.

Build the frontend with `REACT_APP_CAPTCHA_PROVIDER=turnstile+recaptcha`.
The public Google site key is supplied in signupConfig.js and may be overridden
with `REACT_APP_RECAPTCHA_SITE_KEY`. Never put either provider secret in a
REACT_APP variable, repository, build artifact, or browser.

On Render keep both `TURNSTILE_SECRET_KEY` and `RECAPTCHA_SECRET_KEY`, and select
`CAPTCHA_PROVIDER=turnstile+recaptcha` as part of the coordinated release.
The Cloudflare widget must be Managed to allow interaction. Google must be a
v2 checkbox key authorized for myaipa.ca; v3 score tokens are rejected.

Before declaring activation complete, test a real browser on the production
domain: Google checkbox, Cloudflare automatic success, interaction callback
rendering, expiration/error recovery, and rejection when either proof is absent.
Use synthetic providers only for automated tests; never solve or bypass a real
human challenge programmatically. Actual Google acceptance cannot be established
from the public site key or the presence of a secret alone.

Open tabs with an old provider selection must reload during the switch. Never
introduce an OR fallback or accept an unverified provider claim to avoid this.

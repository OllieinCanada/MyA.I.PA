# Owner-only Telegram sign-in preparation

Status: prepared behind `TELEGRAM_OWNER_LOGIN_ENABLED=false`. This document does
not authorize enabling it, changing BotFather, editing messages or sending a test.

## Behavior

At the final notification-send boundary, the three supported website buttons
(signup tracker, exact incident, dashboard) become Telegram `login_url` buttons
only for the pinned positive `TELEGRAM_ADMIN_USER_ID`, its matching PRIVATE
`TELEGRAM_CHAT_ID`, and the matching sending bot token. Ordinary links, other
chats, external provider links and existing guarded-action callbacks are unchanged.
Queued items retain ordinary URLs; no login bearer credential is stored there.

The button contains only a non-secret allowlisted destination, not a 10-minute
admin key. Telegram supplies fresh signed identity when tapped, so an old
notification containing a LoginUrl button can still start a fresh verification.
Telegram may display its own consent/Allow prompt; this does not bypass Telegram
account authentication. This is Telegram Bot API LoginUrl, not Mini App initData
and not the newer OIDC library. Bot API still documents this button type.

The server checks the documented SHA256(bot token)/HMAC-SHA256 signature, the
exact numeric owner ID, a five-minute authentication age (30-second future clock
tolerance), and a signed HttpOnly browser challenge. POST also requires exact
origin, JSON and a custom header. Duplicate/extra fields, unsigned usernames,
invalid destinations, group configuration and enabled admin TOTP fail closed.
Duplicate query fields and extra proof fields are rejected. GET never creates an admin session. The isolated page scrubs the auth query from
browser history immediately, has no third-party assets and uses no-referrer,
no-store, nonce CSP and frame denial. Authorization data arrives in an HTTPS
query as required by the Telegram protocol; review reverse-proxy/access-log
handling before activation. Never log or persist this query/profile/proof.

A durable unique RuntimeStore hash claim is committed before the existing
12-hour admin session cookie is issued. Only hash and timestamps are stored.
Replay across clients or a fresh browser challenge is denied. A five-second
claim deadline is not database cancellation: uncertain/late writes issue no
session and are never automatically retried. Normal password login is unchanged.
No schema change, provider provisioning, billing or receptionist change is made.

## Required activation sequence (not executed)

1. Complete focused tests, exact-lock full CI, guarded real-PostgreSQL cases and
   native HTTPS browser checks. Synthetic Telegram signatures are not real
   Telegram-app acceptance.
2. Have the bot owner confirm/link `api.myaipa.ca` using BotFather `/setdomain`
   for the EXISTING bot. Do not create a bot, rotate tokens, change the webhook
   or add unrelated permissions. Do not paste tokens into chat. Bot API does not
   expose a reliable readback of the LoginUrl domain; record honest owner/UI
   verification rather than claiming `getMe` proves domain binding.
   Read the current linked domain first; stop for an owner decision if replacing
   it would disrupt an existing Telegram login integration.
3. Obtain exact-head merge/deployment approval. Deploy with the feature off and
   verify normal sign-in and anonymous access protection.
4. Obtain explicit approval to enable this one feature flag and perform ONE
   owner-only test notification with the three allowlisted buttons. Confirm the
   configured numeric owner/private-chat binding before changing anything.
5. The owner taps each button in the actual Telegram phone app; check the correct
   destination and absence of an admin password prompt. A controlled other-user
   or forwarded-button rejection test needs separately agreed recipients/scope.
   Do not activate broadly or claim it passed from synthetic browser proof.

## Already-sent notifications (separate, unresolved live step)

Already-delivered plain `url` buttons do not retroactively become LoginUrl
buttons. A release or flag change cannot update them. Do not tell the owner those
old buttons are fixed until their keyboards have actually been refreshed.
Prepare a bounded, owner-reviewed list of exact message IDs, destination-only
keyboard changes and the verified original owner chat before any
`editMessageReplyMarkup` request. Preserve existing approval/dismiss callbacks,
labels and exact incident destinations. Never infer historical chat ownership
from today's global chat setting. If original message identity cannot be proved,
request approval for a replacement owner control message instead of guessing.
No edits, replacements, resends, pins, deletes or old-message migration were
performed in this preparation. Other people's normal links remain protected.

## Test commands

- `npm run test:admin-telegram-login`
- Existing backend security, owner-link, outbox and notification regression tests.
- `RUN_ADMIN_TELEGRAM_POSTGRES=1 npm run test:admin-telegram-login:postgres` on the
  explicitly guarded disposable loopback database only.
- `npm run test:admin-telegram-login:browser` uses the existing ephemeral TLS
  fixture and allowlisted loopback-only proxy, no real Telegram/API/site traffic.

Sources: [Telegram LoginUrl](https://core.telegram.org/bots/api#loginurl) and its
linked [identity-verification protocol](https://core.telegram.org/widgets/login-legacy#checking-authorization).

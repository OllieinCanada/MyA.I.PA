# Personalized outreach workflow

The outreach engine turns supported business context into one reusable package:

`business context → constrained analysis → personalized script → static MP3 → email preview → explicit send`

It is implemented in `server/outreach.js` and exposed through an internal CLI and authenticated admin API routes. It does not create a Vapi assistant per prospect. The existing Vapi native voice is appropriate for interactive phone calls, but Vapi's downloadable recording is a complete call artifact. Clean, one-shot outreach clips therefore use the existing server-side OpenAI credential and speech endpoint with a fixed speak-once instruction. Credentials are never sent to the browser or stored in a package.

## CLI

Generate a local preview without sending:

```powershell
npm run outreach -- --business="Example Business" --website="https://example.com/" --description="Supported business summary"
```

Use the checked-in First Class Rentals input:

```powershell
npm run outreach:test:first-class
```

Preview a generated HTML file:

```powershell
npm run outreach:preview -- --file=outreach-previews/<generated-file>.html
```

Remote production mode authenticates to the existing admin API, generates the package and verifies the public MP3 before it can send:

```powershell
$env:ADMIN_PASSWORD="<existing admin password>"
npm run outreach -- --input=config/outreach/first-class-rentals.json --api-base=https://api.myaipa.ca
```

Sending remains a separate, explicit operation. `--send-test` requires both a recipient and the exact confirmation value:

```powershell
npm run outreach -- --input=config/outreach/first-class-rentals.json --api-base=https://api.myaipa.ca --send-test --to=you@example.com --confirm=SEND-ONE-OUTREACH-TEST
```

If admin MFA is enabled, provide the current code in `ADMIN_MFA_CODE` for that invocation. Do not place passwords or MFA codes in command-line arguments.

## Production API

- `POST /api/admin/outreach/generate` analyzes, generates, validates and stores one package.
- `POST /api/admin/outreach/send-test` sends an already-generated package after explicit confirmation.
- `GET /api/outreach/audio/:filename` serves immutable MP3 files from the existing persistent data disk.

The send route claims a stored package before SMTP delivery. Any package with a prior delivery attempt is rejected, preventing accidental duplicate sends from retries or double clicks.

## Quality gates

Before a package can be stored or sent, the engine verifies:

- a 20–35 second estimated spoken length;
- correct My AI PA-to-business perspective;
- at least three supported business facts;
- a public HTTPS audio URL in production;
- a valid MP3 response;
- an audio link and My AI PA CTA in the email;
- no unresolved placeholders;
- no Gmail-unsupported embedded media tags;
- no common capability overclaims or generic sales jargon.

Generated HTML uses inline styles and presentation tables. The player-looking card is a normal link to the public MP3; it does not use `<audio>`, `<embed>`, `<object>` or `<iframe>`.

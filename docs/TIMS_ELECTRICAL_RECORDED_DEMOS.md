# Tim's Electrical recorded demonstrations

The homepage demo includes six synthetic recorded conversations:

- New installation
- Repair request
- Maintenance
- Talk to the team
- Urgent issue
- Safety redirect

Each recording is a conversation between two isolated Vapi assistants: a fictional caller and the Tim's Electrical demonstration receptionist. The calls use fictional contact details, do not send text messages or webhooks, and do not touch any production customer routing.

## Website assets

The audio files are stored in `public/audio/tims-electrical/`. The scenario-to-file mapping and disclosure are stored in `src/timsElectricalAudioManifest.json`.

The homepage presents each file with a native audio player and the disclosure:

> A recorded demonstration—no real customer information.

## Regenerating the recordings

Start with a dry run:

```powershell
npm run audio:generate-tims-vapi
```

Generate one scenario:

```powershell
npm run audio:generate-tims-vapi -- --apply --confirm=CREATE-TIMS-DEMO-RECORDINGS --only=repair-request
```

Generate all configured scenarios:

```powershell
npm run audio:generate-tims-vapi -- --apply --confirm=CREATE-TIMS-DEMO-RECORDINGS
```

The scenario facts live in `config/tims-electrical-recording-scenarios.json`. The generator creates or reuses resources with these exact Vapi names:

- `My AI PA — Tim's Recorded Demo`
- `My AI PA — Tim's Scenario Caller`
- `My AI PA Tim's Demo Receiver`
- `My AI PA Tim's Demo Caller`

It uses two Vapi-managed US demonstration numbers so no Canadian production line is reassigned.

## Required review

Agent-to-agent calls are non-deterministic. Before publishing regenerated files:

1. Read every transcript written under the ignored local `artifacts/tims-electrical-vapi-recordings/` directory.
2. Confirm the call contains no real personal information.
3. Confirm the receptionist does not quote, diagnose, schedule, transfer, text, or promise service.
4. Confirm every safety scenario immediately redirects the caller to safety and 911.
5. Confirm the final sentence finishes and the call ends normally.
6. Run the Tim demo tests and `npm run build:pages`.

The generator deliberately keeps raw call identifiers and transcripts out of Git. Only approved audio files and their public disclosure manifest belong in the website build.

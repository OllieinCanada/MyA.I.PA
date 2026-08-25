# Toronto Startup Atlas nightly Codex task

Make exactly one bounded, high-value local improvement to Toronto Startup Atlas.

Required workflow:

1. Confirm the working directory is the `toronto-startup-atlas` repository and `git status --short` is clean. Stop with a report if it is not.
2. Read `AGENTS.md`, `README.md`, `package.json`, and the relevant existing scripts/tests before editing. Follow the bundled Next.js documentation required by `AGENTS.md` for any framework-specific change.
3. Choose one small next improvement supported by an existing TODO, test gap, accessibility issue, source-attribution gap, data-quality issue, or obvious user-facing defect. Do not start a broad feature or redesign.
4. Work only with local evidence. Do not browse, fetch current event data, install dependencies, access accounts, send messages, publish content, deploy, or push.
5. Preserve privacy-first analytics and factual source attribution. Do not turn one-browser local analytics into community-wide claims.
6. Run `npm run typecheck`, `npm run test:data`, and `npm run build`. If any fail, fix the local regression or revert only your own run's edits.
7. If all checks pass and changes are meaningful, update the appropriate local documentation and create one local Git commit beginning `Codex automation:`. Never push.
8. A safe no-op is acceptable when no bounded improvement is justified.
9. End with exactly these headings: `## Outcome`, `## Changed`, `## Verification`, `## Approval needed`, `## Next task`, and `## External actions`. State `None` under approval or external actions when applicable.

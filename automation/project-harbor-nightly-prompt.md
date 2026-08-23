# Project Harbor nightly Codex task

Make exactly one bounded, high-value local improvement to Project Harbor.

Required workflow:

1. Confirm the working directory is `D:\ProjectHarbor\workspace` and `git status --short` is clean. Stop with a report if it is not.
2. Read `AGENTS.md`, `README.md`, the newest `CHANGELOG.md` entry, `project.godot`, and the relevant existing scripts/tests before editing.
3. Select one small next improvement from documented plans, an existing failing test, or a clearly evidenced gameplay/quality gap. Do not invent a large new feature.
4. Preserve the clean-room boundary. Never copy or use Rockstar source code, maps, missions, branding, models, textures, audio, or other copyrighted assets.
5. Do not use the browser, network, downloads, external accounts, messages, publishing, deployment, export, or replacement of the top-level playable build.
6. Reuse existing tools. Do not install dependencies or alter the portable Godot/Blender toolchains.
7. Run all six headless Godot suites listed in `AGENTS.md`. If any fail, fix the local regression or revert only your own run's edits.
8. If all checks pass and changes are meaningful, update `CHANGELOG.md` concisely and create one local Git commit beginning `Codex automation:`. Never push.
9. Report what changed, verification results, the next best task, and anything requiring Oliver's approval. A safe no-op is acceptable when no bounded improvement is justified.

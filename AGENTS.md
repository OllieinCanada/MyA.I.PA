# Agent Instructions

Before starting a task, check whether this project already has an automation script for it.

1. Inspect `package.json` scripts and the `scripts/` folder first.
2. If an existing script matches the task, use it instead of repeating the work manually.
3. If no script exists and the task is likely to repeat, consider adding a small script before doing the task by hand.
4. Prefer these project scripts for common workflows:
   - `npm run build:pages` for building and syncing `docs/`.
   - `npm run deploy:pages` for building, committing, and pushing the live GitHub Pages build.
   - `npm run preview:fresh` for restarting a clean local preview.
   - `npm run diagnose:site` for checking build, branch, commit, and GitHub Pages state.
   - `npm run diagnose:signup` for signup/Make.com handoff diagnostics.
   - `npm run diagnose:visual` for screenshot-based layout checks on the homepage and signup page.
   - `npm run telegram:send-voicemail-section:local` after local homepage visual changes to send the exact laptop-width voicemail section screenshot for review.
   - `npm run telegram:send-voicemail-section` after live deployment, when the user asks to verify the GitHub Pages version of the voicemail section.
   - `npm run test:signup-payload` for generating or posting a sample signup payload.
   - `npm run usage:note` for logging manually checked Codex 5-hour and weekly usage percentages.
   - `npm run audio:update-tims` for updating Tim's Electrical audio assets.
   - `npm run transcript:tim` for refreshing transcript text from an existing transcript file.

Do not push to GitHub unless the user explicitly asks for live deployment.

For homepage visual/layout fixes, do not rely only on automated "no obvious visual issues" output. Inspect the exact section screenshot the user cares about, and send the local Telegram screenshot before calling the fix done.

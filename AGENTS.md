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

## Authorization and release rules

Treat authorization as current task state, not reusable boilerplate.

- Never copy merge/deployment/approval language from an older PR without revalidating it against the user's latest instructions and current `main`.
- Authorization does not automatically carry forward from one PR to another.
- Likewise, an old requirement for "fresh exact-head approval" does not remain in force unless it is still present in current project instructions or the user explicitly requires it for the current task.
- Before writing a PR's release/authorization section, inspect current `AGENTS.md`, current `main`, and any immediately preceding related merged PRs that changed the release workflow.
- If the working branch was created before a relevant policy/workflow PR merged, refresh against current `main` before deciding what authorization rules apply.
- Do not invent safety gates merely because previous PRs used them.

Treat these as independent actions unless the user explicitly combines them:

1. modify local files
2. commit
3. push
4. open or update a PR
5. merge
6. deploy
7. enable a production feature or configuration
8. initiate real calls, messages, or provider actions
9. initiate paid tests or purchases

Record only the permissions the user has actually granted.

When the user explicitly says something such as "merge and deploy it," that authorization controls the current requested release workflow. Do not subsequently reintroduce a superseded "exact-head approval required" gate unless the user asks for it or current project policy independently requires it.

Before merge or deployment, re-read the current PR description and current project instructions. If the PR description contains an authorization statement inconsistent with the user's latest instruction, correct the description instead of blindly enforcing stale text.


For homepage visual/layout fixes, do not rely only on automated "no obvious visual issues" output. Inspect the exact section screenshot the user cares about, and send the local Telegram screenshot before calling the fix done.

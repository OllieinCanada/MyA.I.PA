# Reviewed Node runtime baseline

The application baseline is Node **24.22.3**, from the official November 11,
2026 security release. Keep `.node-version`, the package/lockfile engine range,
Docker tag, Render `NODE_VERSION`, workflow selections and regression assertions
aligned when reviewing later patches. No dependency resolutions change here.

Advisory: https://nodejs.org/en/blog/vulnerability/november-2026-security-releases

## Evidence and boundaries

- Before this patch, Docker and explicit CI selections used Node 20.
- Render metadata confirms a native Node service, not this Docker image.
- A read-only check found no service-level `NODE_VERSION` override. The log
  service was unavailable, so the existing live Node version is **unverified**.
- The local primary runtime was 24.22.1. Tests for this change use a separate
  official 24.22.3 Windows archive on D:, checked against its published SHA-256.
  The primary runtime and shared dependencies are not modified.
- Selecting application Node does not upgrade the internal runtime of third-party
  GitHub JavaScript Actions. Review those Actions independently.
- The official Docker Hub tag metadata was checked and its multi-platform digest
  pinned in the Dockerfile. This is registry evidence, not a successful build.

## Validation and release

1. Select Node with `.node-version` (or install official 24.22.3). Run a clean
   `npm ci --include=dev --legacy-peer-deps` in CI/a disposable environment.
2. Run `npm run test:request-security`, the Node baseline tests,
   `npm run backend:check`, `npm run render:validate`, the full backend/frontend
   suites, Prisma generation, build and existing no-send PostgreSQL/browser CI.
   Test the alternative Docker build separately before claiming container proof.
3. Obtain exact-head merge/deployment approval. Do not change live settings during
   preparation. A Blueprint edit alone does not prove the existing service has
   synchronized it. Confirm the effective runtime selector: Render prioritizes
   service `NODE_VERSION`, then `.node-version`, then `.nvmrc`, then engines.
4. After an approved release, require the exact deployed commit, normal readiness
   and authenticated `/api/internal/operations/security-readiness` evidence with
   `versions.node` on patched Node 24. `npm run security:verify-release --
   --commit=<exact-merge-sha>` checks all three and the locked build command.
   Never print the monitor credential. This security endpoint reports 503 for an
   unsupported/unpatched runtime; it does not stop calls or alter health readiness.
5. Render has an attached disk, so plan for a deploy interruption. Do not place
   calls, send texts, restart observation or enable any unrelated feature.

## Rollback

No schema or provider changes are introduced. If compatibility checks fail, keep
the old release live while repairing the branch. After release, prefer a forward
fix on patched Node 24. An emergency application rollback must also verify the
effective Node version; restoring an older artifact may restore an unsafe runtime.
Do not claim a runtime rollback is security-equivalent. Recovery of database or
provider state is not required or authorized by this patch.

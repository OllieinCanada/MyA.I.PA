# Backup and Restore Runbook

Owner: designated production operator
Privacy review: Privacy Officer (appointment pending)
Proposed controlled-pilot objectives: RPO no worse than 24 hours; RTO four hours.
The owner must approve these targets and their measurement boundaries before execution. They are not customer service-level promises. A logical archive restore time is not complete-service RTO, and an export's catalog creation time is not an independently verified transaction cutoff.

## Current architecture

- The production blueprint uses paid Render Postgres (`basic-256mb`) and a one-gigabyte persistent service disk.
- Render documents point-in-time recovery for paid Postgres. The actual recovery window depends on the Render workspace plan and must be verified in the production dashboard.
- Render logical exports remain downloadable for seven days. A longer private copy requires separately approved encrypted storage.
- The persistent disk and PostgreSQL database are different recovery surfaces. A database backup does not automatically prove that disk-based legacy/runtime state is recoverable.

## Backup schedule

- Continuous: Render-managed PITR, verified monthly in the dashboard.
- Weekly: PostgreSQL custom-format logical export.
- Before risky schema/provider work: fresh logical export and rollback record.
- Monthly: encrypted copy placed in approved restricted backup storage.
- Quarterly: isolated restore drill using the newest verified backup.

## Create and verify a logical backup

1. Install PostgreSQL client tools matching the production major version.
2. Place the production `DATABASE_URL` only in the protected environment.
3. Run `npm run ops:backup:check`.
4. Set `BACKUP_ENCRYPTION_KEY` from an approved secret manager. The backup command refuses to create an unencrypted archive.
5. Run `npm run ops:backup` only under explicit backup-execution authority.
6. Confirm the generated manifest reports `archiveListVerified: true`, `encrypted: true`, a non-zero byte count, and a SHA-256 digest.
7. Move the encrypted backup through an approved channel to restricted storage.
8. Set `RESTORE_BACKUP_PATH` and run `npm run ops:backup:restore-drill` to verify checksum, decryption, and archive readability.
9. For a full drill, set a disposable `RESTORE_DATABASE_URL`, set `RESTORE_DRILL_CONFIRM=RESTORE_TO_DISPOSABLE_DATABASE`, and run `npm run ops:backup:restore-drill -- --restore`.

PostgreSQL custom format is compressed but is not encryption. The backup script encrypts the verified archive with AES-256-GCM and deletes its temporary plaintext copy. It never writes the database URL, password, or encryption key to its manifest. Backup files contain personal information and must never be committed, attached to GitHub, emailed, or placed in general cloud storage.

When running from an isolated worktree, set `OPERATIONS_ENV_FILE` to the protected `.env.local` path. Do not copy the environment file into the worktree or print its contents.

## Restore drill

Never test a restore over the production database.

1. Open an incident/change record and select a recovery timestamp.
2. For the prepared local runner, create a new execution-owned loopback PostgreSQL instance. It verifies the database name, server system identifier, data directory, age, advisory lock and empty target. A localhost tunnel to production is not an isolated target. Creating a hosted database needs separate resource approval and is not supported by this runner.
3. Restrict network access and operator permissions.
4. Restore the archive into the empty database using the matching `pg_restore`.
5. Verify the schema and aggregate data in the sealed recovery database without starting the application or delivery workers. Perform application smoke tests separately in a synthetic functional staging environment, not in the production-data recovery copy.
6. Verify archive/table counts, constraints and required relationships without exporting personal information. Inspect indexes and sequence positions separately; row counts alone do not establish their correctness.
7. Replay post-backup deletion, correction, withdrawal, suppression, and closure events.
8. Verify tenant isolation, calendar-token encryption, notification routing, and critical foreign-key relationships.
9. Record backup timestamp, recovery point, start/end time, errors, RPO, RTO, verifier, and evidence.
10. Stop and remove only the execution-owned disposable target and temporary plaintext. Record whether the encrypted local archive was retained or removed under its approved custody/retention policy; keep sanitized evidence and preserve the hosted source backup.

## Metadata only recovery preparation

`npm run ops:backup:prepare-recovery` performs no network calls, creates no export and starts no database. Supply a JSON metadata file containing only `releaseCommit`, `databaseId`, `serviceId`, `exportId`, `exportCreatedAt` and `maximumSnapshotAgeHours`. Use a full commit and one exact, completed export ID obtained from an authorized metadata read. The explicit age limit is a selection policy, not an RPO promise. Do not include credentials or signed download URLs.

```text
npm run ops:backup:prepare-recovery -- --metadata=PATH_TO_METADATA --out-dir=NEW_EVIDENCE_DIRECTORY
npm run ops:backup:prepare-recovery -- --plan=NEW_EVIDENCE_DIRECTORY/plan.json
```

The output directory must be new. Preparation creates a checksummed `plan.json` and a new `execution.json`; it does not authorize execution. Keep evidence directories out of Git. Do not reuse the older provider-hardening execution, export-request receipt or encrypted-artifact pointer. A changed release, expired plan, stale export, duplicate export ID or uncertain previous attempt blocks execution; it must not select a newer backup automatically. Checksums detect accidental changes, not malicious modification by an authorized local writer.

After separate execution approval, collect fresh exact-release health into that same directory:

```text
npm run ops:hardening:health -- --commit=FULL_COMMIT --directory=NEW_EVIDENCE_DIRECTORY
```

This is a GET-only check, not a 24-hour observation. The runner requires passing health less than ten minutes old and a preparation less than one hour old, then rechecks the live commit before reading the backup key. Default runner behavior validates metadata only. Download and disposable restore each require explicit confirmation:

```text
npm run ops:backup:render-restore -- --plan=NEW_EVIDENCE_DIRECTORY/plan.json
npm run ops:backup:render-restore -- --plan=NEW_EVIDENCE_DIRECTORY/plan.json --execute --confirm=DOWNLOAD_ENCRYPTED_LOGICAL_BACKUP --confirm-restore=RESTORE_TO_DISPOSABLE_DATABASE --schema-review=REVIEWED_SCHEMA_TICKET
```

The package command includes `--restore`; without `--execute` it still performs no download or restore. Do not run the second command without separate operational authority. If the encrypted archive has not yet been downloaded, an authorized operator can invoke `node scripts/run-render-backup-restore-drill.js --plan=PLAN --execute --confirm=DOWNLOAD_ENCRYPTED_LOGICAL_BACKUP` without `--restore`. The wrapper never creates an export. It allows only the exact selected HTTPS backup origin, refuses redirects, caps downloads at 512 MiB, and requires at least 2 GiB free on its private working volume. The default Windows working volume is under Local AppData; insufficient space blocks it. Choosing a different storage volume requires a reviewed private-path configuration, not an increased limit or copying archives into the repository or OneDrive.

Receipts are created exclusively before download or restore. An uncertain outcome must be investigated, not retried. Restore children receive only a small operating-system environment and the backup key, never inherited source-database or provider credentials. Executable/foreign objects, materialized views and unknown object types stop the drill. TOC screening is not a SQL parser or an OS sandbox: default expressions and other schema SQL can still execute built-in operations. Before applying a production archive, separately review its exact pre/post schema SQL and provide a fresh review ticket bound to both encrypted-archive and schema-SQL SHA-256 digests. The inner restore helper enforces the ticket even when called directly. No arbitrary archive is automatically approved.

For an authorized private schema inspection, use the protected backup key and matching client tools, then run `npm run ops:backup:restore-drill -- ENCRYPTED_ARCHIVE --inspect-schema` without `--restore`. This decrypts only in private temporary storage, writes schema SQL and a pending `schema-review.json` into a separate ACL-restricted directory, and prints only metadata/path information. Schema SQL can contain sensitive defaults/comments: do not commit, message or publish it. A qualified operator must inspect all of it, record an approved decision, review reference and current `reviewedAt`, and remove the private schema files after their approved retention period. A pending ticket cannot authorize restoration. Known fixed synthetic fixtures may create their own exact digest ticket; supplied production archives may not.

Each child result is written exclusively inside its own execution directory and returns the checked artifact/execution/release identity. The parent verifies those identities and timing, so overlapping executions cannot adopt a shared stale result. Successful output proves only logical database restoration and explicitly leaves disk state, key custody and complete service recovery unproven.

## Complete service recovery requirements

A database export does not include file-backed signup/payment handoff, trial-reminder, dashboard or call-sync state on the service disk. Inventory which `/data` files remain authoritative, their encryption/signing keys and the order in which they must be reconciled with the database. Rehearse a coherent database/file recovery point, deletion and opt-out replay, duplicate prevention, key recovery and a controlled cutover with dispatch disabled. Never restore a whole live disk snapshot merely to test a file: it can discard newer writes.

Select a separate synthetic functional staging database, files, credentials and approved destinations. Prove isolation, rollback and monitoring independently. A staging flag, a restored production-data copy or a passing local fixture does not satisfy these requirements.

## Production recovery

Prefer Render PITR when it provides a more recent safe recovery point. Render creates a new database instance; validate it before switching the application connection string. Preserve the original database until the recovered instance is verified and counsel/incident leadership approves the cutover.

## Failure conditions

Treat any of these as a high-priority operational incident:

- paid database recovery is not enabled;
- no verified logical backup exists within seven days;
- backup checksum/archive verification fails;
- restore drill exceeds the four-hour pilot target;
- backup access is broader than production database access;
- a restored database revives deleted or suppressed information;
- backup or manifest is exposed through Git, diagnostics, support, or messaging.

Official references: [Render PostgreSQL backups](https://render.com/docs/postgresql-backups), [PostgreSQL pg_restore security and SQL output](https://www.postgresql.org/docs/18/app-pgrestore.html).

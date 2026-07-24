# Backup and Restore Runbook

Owner: designated production operator
Privacy review: Privacy Officer (appointment pending)
Target during controlled pilot: RPO no worse than 24 hours; RTO four hours
These targets are internal objectives, not customer service-level promises.

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
4. Run `npm run ops:backup`.
5. Confirm the generated manifest reports `archiveListVerified: true`, a non-zero byte count, and a SHA-256 digest.
6. Encrypt the archive using the approved backup-storage mechanism or approved file-encryption tool.
7. Move the encrypted backup through an approved channel to restricted storage.
8. Verify the encrypted copy can be decrypted in the isolated restore environment.
9. Delete unencrypted local working copies after transfer verification under the approved schedule.

PostgreSQL custom format is compressed but is not encryption. The backup script never claims otherwise and never writes the database URL or password to its manifest. Backup files contain personal information and must never be committed, attached to GitHub, emailed without approved encryption, or placed in general cloud storage.

When running from an isolated worktree, set `OPERATIONS_ENV_FILE` to the protected `.env.local` path. Do not copy the environment file into the worktree or print its contents.

## Restore drill

Never test a restore over the production database.

1. Open an incident/change record and select a recovery timestamp.
2. Create a new isolated Render database or other empty test PostgreSQL instance.
3. Restrict network access and operator permissions.
4. Restore the archive into the empty database using the matching `pg_restore`.
5. Run Prisma validation and application smoke tests against the isolated database.
6. Verify row counts and representative synthetic records without exporting production personal information.
7. Replay post-backup deletion, correction, withdrawal, suppression, and closure events.
8. Verify tenant isolation, calendar-token encryption, notification routing, and critical foreign-key relationships.
9. Record backup timestamp, recovery point, start/end time, errors, RPO, RTO, verifier, and evidence.
10. Destroy the isolated restore after approval and confirm its deletion.

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

Official reference: https://render.com/docs/postgresql-backups

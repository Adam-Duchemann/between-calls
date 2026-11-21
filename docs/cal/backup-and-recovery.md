# Backups and recovery

Back up your PostgreSQL database and store the deployment configuration separately in a secret store. Recovery requires the corresponding `CALENDSO_ENCRYPTION_KEY` to decrypt connection credentials. Keep the authentication secret and provider keys available to the operator. Treat database copies as sensitive because they contain booking and account data.

The repository includes `scripts/cal-backup.mjs`, which can produce an encrypted PostgreSQL backup. Read its arguments and environment requirements before scheduling it. Restrict access to the backup location and encryption passphrase. Use a separate database for a restore exercise and keep external email and provider writes disabled there.

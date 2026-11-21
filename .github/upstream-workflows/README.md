# Archived upstream workflows

These Cal.diy workflows are retained unchanged for reference. They are outside `.github/workflows` so enabling Actions for the private CAL repository cannot start inherited schedules, releases or pull-request automation.

Only `.github/workflows/cal-private-build.yml` is runnable. Restore an upstream workflow only after reviewing its triggers, permissions, credentials and resource use for this installation. `node --test scripts/ci-policy.test.mjs` checks this boundary, including after upstream merges.

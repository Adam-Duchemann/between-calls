# Between Calls

Between Calls is a self-hosted appointment scheduler based on [Cal.diy](https://github.com/calcom/cal.diy).

- Share a public booking link for each meeting type.
- Assign named availability schedules and edit them in a calendar or list.
- Offer a fixed number of times per day or week, or hide a percentage. Picks are consistent across visitors and respect calendar conflicts.
- Connect Google calendars to check conflicts and show external events alongside bookings.
- Customize guest booking pages and send booking, rescheduling and cancellation emails.
- Connect an MCP client to read availability and propose changes for the host to approve.

The Docker build targets a single host. Multi-host and round-robin scheduling are outside the supported configuration for this release.

## Run locally

Use Node 22, Docker Compose and the checked-in Yarn runner. Copy `.env.example` to `.env` and follow the [local development steps](docs/cal/runtime.md#isolated-local-development) to generate secrets and start PostgreSQL and Mailpit.

## Self-host

See [deployment](docs/cal/vercel-deployment.md) for Docker or Vercel with PostgreSQL, [Google Calendar and email setup](docs/cal/provider-setup.md), and [backups](docs/cal/backup-and-recovery.md).

## License

This project is derived from Cal.diy, © Cal.com, Inc. See the [MIT license and copyright notice](LICENSE). Bundled components retain their own notices.

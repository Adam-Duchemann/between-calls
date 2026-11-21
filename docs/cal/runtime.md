# CAL runtime

CAL retains Cal.diy's Node 22, Yarn 4.12, Next.js, Prisma and PostgreSQL stack.

## Database setup and startup

Load the target environment, then run `sh scripts/setup-cal.sh` explicitly before starting a new installation or releasing a migration. It deploys committed migrations and seeds the app catalog. It stops if a migration fails. It does not seed demo users. The Prisma adapter reads its connection string during module initialization, so loading environment variables inside the seed script is too late.

`scripts/start.sh` only updates a changed public URL in the built assets and starts the application. Container restarts never deploy migrations or seed the database. Set `NEXT_PUBLIC_WEBAPP_URL` to the installation's actual URL. Keep database credentials, authentication/encryption secrets and provider credentials in environment secrets, outside version control.

Run the startup regression checks with `node --test scripts/start.test.mjs`.

## Production build

Run `yarn build:cal` with the build environment loaded. It first checks browser import boundaries with a small Webpack bundle, then builds workspace dependencies, copies app-store assets, generates route types, runs the forced repository-wide type check one workspace at a time, and runs Next.js Webpack compile and generate phases in separate processes. Every stage stops on failure. It does not disable type checking or publish a release. The default Node heap is 6 GiB and static generation uses two workers. Webpack uses its build worker and memory optimizations; private mode omits browser production source maps. Allow substantial memory and disk headroom on the build machine.

Shared locale metadata lives in `@calcom/i18n/locale-config`. Keep filesystem paths in the server-only `next-i18next.config` module. Browser entrypoints use Next.js's public environment handling and must not import `node:process`. `node --test scripts/browser-build.test.mjs` checks these boundaries before a long production build.

The standalone trace explicitly includes the app's nested Sharp native packages. The app and Next.js use different Sharp versions; omitting the nested binaries can load the wrong native library and break API routes. `node scripts/check-standalone.mjs <standalone-root>` checks packaged assets, the non-root user and a real image resize. The Linux workflow runs this inside the finished image.

The split uses Next.js's experimental build modes, pinned by this repository's Next version. Both phases must finish before an image is released. Recheck this path when upgrading Next.js. The ordinary upstream `yarn build` remains available, but overlapping compiler and type-checker processes can increase peak memory use. `build:cal` forces `SKIP_DB_MIGRATIONS=1` because the upstream Prisma build task otherwise runs migrations. Database changes belong only to the explicit release setup step. `node --test scripts/build-cal.test.mjs` verifies ordering, migration exclusion and failure propagation.

Next 16.4.3 renames its proxy output during both split phases ([upstream issue](https://github.com/vercel/next.js/issues/86753)). Between them, `scripts/prepare-next-generate.mjs` copies the compiled middleware and its file trace back to the proxy filenames expected by `generate`. It preserves the middleware needed while pages load, restores the trace's self-reference and rejects incomplete output. The build and helper regression suites cover this handoff. Recheck whether the workaround is needed when upgrading Next.js.

The build uses `yarn type-check --force --concurrency=1`, whose workspace tasks invoke TypeScript directly. The upstream `type-check:ci` tasks use `tsc-absolute`/`process-wrapper`, which was reproduced returning exit 0 for a compiler killed by a signal. Treat any interrupted run of that wrapper as incomplete even if Turbo reports success. CAL's build regression suite also checks that a signalled type-check process stops subsequent build phases.

## Isolated local development

Use Node 22 and the checked-in Yarn runner. After preparing a private `.env` from `.env.example`, set `CAL_DEV_DATABASE_PASSWORD` and matching `DATABASE_URL` / `DATABASE_DIRECT_URL` values for `postgresql://cal:<password>@127.0.0.1:55432/cal`. Generate unique authentication and encryption secrets. Never commit `.env`.

```sh
docker compose -f compose.cal-dev.yml up -d
node .yarn/releases/yarn-4.12.0.cjs install --immutable
node --env-file=.env .yarn/releases/yarn-4.12.0.cjs exec sh scripts/setup-cal.sh
node .yarn/releases/yarn-4.12.0.cjs workspace @calcom/web dev --hostname 127.0.0.1 --port 3100
```

Set the public app/website/auth URLs to your local port 3100 URL. The compose project binds PostgreSQL and Mailpit only to loopback. Set `EMAIL_SERVER_HOST=127.0.0.1`, `EMAIL_SERVER_PORT=11025` and a test sender; leave `RESEND_API_KEY` and other SMTP authentication unset for local capture. The local inbox is at `http://127.0.0.1:18025`. Its messages are not delivered externally.

The initial setup page creates the owner account when the database has no users. Do not expose an uninitialized instance publicly. The local database lives in the `cal-private-v1_cal-database` named volume. `docker compose -f compose.cal-dev.yml stop` preserves it.

For the private deployment, set `CAL_PRIVATE_INSTANCE=true` and `NEXT_PUBLIC_DISABLE_SIGNUP=true` before building and starting the app. The server closes password signup even when a request supplies an invitation token. OAuth and magic-link sign-in require an existing verified, unlocked account; they cannot create a new public account. Password sign-in retains its existing password and two-factor checks. The first-admin setup route remains available only while the database is empty, so initialize it on loopback or behind access control before publishing the guest booking pages. Calendar connections are separate from login: multiple Google calendar accounts can still be connected in Settings. Provision colleagues explicitly before enabling their sign-in; team/organization and round-robin permissions remain a separate release prerequisite. Private setup creates the first owner, a Monday–Friday 09:00–17:00 UTC schedule and a 30-minute Google Meet type in one serializable transaction. Connect Google and validate email delivery before sharing the booking link.

See the [deployment guide](./vercel-deployment.md) for self-hosting with Docker or Vercel and PostgreSQL.

## Personal meeting type authorization

Meeting type procedures reject conflicting event IDs before looking up the requested event. With `CAL_PRIVATE_INSTANCE=true`, the read and edit procedures require the personal owner. Older personal types with no owner field can use their single assigned user as the owner. Team, managed and round-robin types are outside that scope.

Updates reject team and organization associations and verify ownership of all supplied schedule references before saving. The event editor still supports assigning an owned named schedule, resetting to the default schedule and changing look-busy settings. Team authorization remains a separate requirement before enabling teams.

With private mode enabled, public event pages, slot lookups, slot holds and booking intake accept personal, non-seated event types. Team, managed, organization and dynamic group events are unavailable to guests. The isolated PostgreSQL regression verifies that a two-host round-robin event offers slots with private mode disabled and is refused across the guest booking paths with private mode enabled.

## Simultaneous bookings and confirmation recovery

Private booking saves serialize per organizer and recheck buffered conflicts and event-type count/duration limits inside the saving transaction. Limits use the event schedule's timezone, then the owner's default schedule and the native timezone fallback. Rescheduling excludes the original booking and accepts only one replacement. Transactions explicitly use PostgreSQL Read Committed so a request waiting for the organizer lock sees the preceding committed booking.

Manual confirmation claims a pending request under the same organizer lock before creating provider events. A duplicate confirmation or a request already cancelled/rejected cannot claim it again. Confirmation emails follow the database update. Payments and recurring confirmation are outside private v1.

PostgreSQL and external providers do not share a transaction. If a provider response is lost after the confirmation claim, the booking remains accepted and automatic confirmation retries are refused. Inspect the booking, provider calendar and delivery logs before retrying any external action. A cancellation while provider creation is in flight also requires checking for an orphan provider event. The concurrency tests use a real isolated PostgreSQL database with mocked provider effects; they do not prove live Google/Resend recovery.

# Self-hosting

Use a dedicated PostgreSQL database. Copy `.env.cal.example` to your private deployment environment, supply its required values, and run `node --env-file=.env scripts/check-cal-env.mjs`. Set the application URLs to the same public HTTPS origin. Configure a direct PostgreSQL connection or a session pooler for migrations. For a serverless runtime, use the PostgreSQL provider's runtime connection and pooling settings.

From the source checkout, install dependencies and initialize the database with the target environment loaded.

```sh
corepack enable
yarn install --immutable
yarn exec sh scripts/setup-cal.sh
```

Complete first-admin setup behind access control before exposing guest routes. This setup creates a UTC schedule that the host can change in Availability. Next, [connect Google](provider-setup.md#google-calendar) and [configure transactional email](provider-setup.md#email).

## Docker

Build once with the final public origin and start the image with the private runtime environment.

```sh
docker build -f Dockerfile.cal --build-arg NEXT_PUBLIC_WEBAPP_URL=https://booking.example.com -t between-calls:local .
docker run --rm --env-file .env -p 127.0.0.1:3000:3000 between-calls:local
```

Terminate HTTPS at a reverse proxy. Apply new migrations from the source checkout before replacing the image. The runtime image starts Next.js and does not run the schema migration or create the owner account.

## Vercel and Supabase

Import the monorepo. Use the repository's Node and Yarn versions and set the build command to `yarn build:cal`. Set build and runtime environment variables in the deployment environment. Use the Supabase project’s migration and runtime connection strings in the corresponding variables. Perform migrations as a separate release step using the direct or session connection.

Load a published event link in a signed-out browser. Choose a Vercel protection configuration that allows access to guest routes at the public alias. The app still authenticates dashboard and settings routes.

## Before sharing a link

Verify that anonymous guests can load the event, choose an offered time and receive the confirmation. Test a reschedule and cancellation using your own address. Check that connected calendars block genuine conflicts and that the final email and calendar state agree.

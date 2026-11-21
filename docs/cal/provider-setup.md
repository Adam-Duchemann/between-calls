# Provider setup

Use credentials for your own installation and keep them in its runtime secret store.

## Google Calendar

Create a Google OAuth web application, enable the Calendar API, and add the exact authorized redirect URI for your deployment. For example, use `https://booking.example.com/api/integrations/googlecalendar/callback`. Put the downloaded web-client JSON in `GOOGLE_API_CREDENTIALS` and run the database/app catalog setup from the [deployment guide](vercel-deployment.md).

Open the calendar settings as the host. Authorize each required Google account, choose the calendars that should block availability, and pick a destination calendar for bookings. Choose Google Meet as a meeting location if desired. OAuth testing, publication and verification depend on your audience and scopes. Use your own app information and privacy notice when registering the integration.

## Email

Set `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_FROM_NAME` to send via Resend. Verify a domain you control and use a sender on that domain. For local development, use Mailpit as described in the [runtime guide](runtime.md#isolated-local-development). Test receipt using an inbox you control before sharing booking links.

## Information pages

Review the information, privacy and terms copy against your installation's data practices before setting `CAL_PUBLIC_INFORMATION_ENABLED=true`. Set `CAL_PUBLIC_CONTACT_EMAIL` to an address the operator monitors. The pages appear at `/cal-info`, `/cal-privacy` and `/cal-terms`.

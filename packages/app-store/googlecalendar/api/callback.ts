import process from "node:process";
import { createGoogleCalendarServiceWithGoogleType } from "@calcom/app-store/googlecalendar/lib/CalendarService";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import { buildCredentialCreateData } from "@calcom/features/credentials/services/CredentialDataService";
import { renewSelectedCalendarCredentialId } from "@calcom/lib/connectedCalendar";
import {
  GOOGLE_CALENDAR_SCOPES,
  SCOPE_USERINFO_PROFILE,
  WEBAPP_URL,
  WEBAPP_URL_FOR_OAUTH,
} from "@calcom/lib/constants";
import { getSafeRedirectUrl } from "@calcom/lib/getSafeRedirectUrl";
import { HttpError } from "@calcom/lib/http-error";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import { Prisma } from "@calcom/prisma/client";
import { calendar_v3 } from "@googleapis/calendar";
import { oauth2_v2 } from "@googleapis/oauth2";
import { OAuth2Client } from "googleapis-common";
import type { NextApiRequest, NextApiResponse } from "next";
import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import { OAuth2UniversalSchema } from "../../_utils/oauth/universalSchema";
import { updateProfilePhotoGoogle } from "../../_utils/oauth/updateProfilePhotoGoogle";
import { finishBrowserOAuth } from "../lib/browserOAuth";
import { getGoogleAppKeys } from "../lib/getGoogleAppKeys";
import { savePrivateGoogleConnection } from "../lib/privateConnection";

async function getPrimaryCalendarId(auth: OAuth2Client) {
  try {
    const calendar = new calendar_v3.Calendar({ auth });
    const { data } = await calendar.calendars.get({ calendarId: "primary", fields: "id" });
    return data.id || null;
  } catch {
    return null;
  }
}

async function getGoogleAccountId(auth: OAuth2Client) {
  try {
    const profile = new oauth2_v2.Oauth2({ auth });
    const { data } = await profile.userinfo.get({ fields: "id" });
    return data.id || null;
  } catch {
    return null;
  }
}

async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  if (!req.session?.user?.id) {
    throw new HttpError({ statusCode: 401, message: "You must be logged in to do this" });
  }
  res.setHeader("Cache-Control", "no-store");
  const authorization = finishBrowserOAuth(req);
  if (!authorization) {
    throw new HttpError({
      statusCode: 400,
      message: "Google authorization expired or invalid. Start again from CAL.",
    });
  }
  const { state, codeVerifier } = authorization;

  if (typeof code !== "string" || !code) {
    if (state?.onErrorReturnTo || state?.returnTo) {
      res.redirect(
        getSafeRedirectUrl(state.onErrorReturnTo) ??
          getSafeRedirectUrl(state?.returnTo) ??
          `${WEBAPP_URL}/apps/installed`
      );
      return;
    }
    throw new HttpError({ statusCode: 400, message: "`code` must be a string" });
  }

  const { client_id, client_secret } = await getGoogleAppKeys();

  const redirect_uri = `${WEBAPP_URL_FOR_OAUTH}/api/integrations/googlecalendar/callback`;

  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uri);

  const token = await oAuth2Client.getToken({ code, codeVerifier });
  const key = token.tokens;
  const grantedScopes = token.tokens.scope?.split(" ") ?? [];
  // Check if we have granted all required permissions
  const hasMissingRequiredScopes = GOOGLE_CALENDAR_SCOPES.some((scope) => !grantedScopes.includes(scope));
  if (hasMissingRequiredScopes) {
    if (!state?.fromApp) {
      throw new HttpError({
        statusCode: 400,
        message: "You must grant all permissions to use this integration",
      });
    }
    res.redirect(
      getSafeRedirectUrl(state.onErrorReturnTo) ??
        getSafeRedirectUrl(state?.returnTo) ??
        `${WEBAPP_URL}/apps/installed`
    );
    return;
  }

  oAuth2Client.setCredentials(key);

  if (process.env.CAL_PRIVATE_INSTANCE === "true") {
    if (!key.access_token || !key.refresh_token) {
      throw new HttpError({
        statusCode: 400,
        message: "Google did not provide offline access. Start again from CAL and grant calendar access.",
      });
    }
    const [googleAccountId, primaryCalendarId] = await Promise.all([
      getGoogleAccountId(oAuth2Client),
      getPrimaryCalendarId(oAuth2Client),
    ]);
    if (!googleAccountId || !primaryCalendarId) {
      throw new HttpError({
        statusCode: 502,
        message: "CAL could not verify your Google Calendar account.",
      });
    }
    await savePrivateGoogleConnection({
      userId: req.session.user.id,
      googleAccountId,
      primaryCalendarId,
      tokens: { ...key },
      resolveLegacyAccount: async (storedKey) => {
        const parsed = OAuth2UniversalSchema.safeParse(storedKey);
        if (!parsed.success) return null;
        const priorAuth = new OAuth2Client(client_id, client_secret, redirect_uri);
        priorAuth.setCredentials(parsed.data);
        return getGoogleAccountId(priorAuth);
      },
    });
  } else {
    const gcalCredentialData = buildCredentialCreateData({
      userId: req.session.user.id,
      key,
      appId: "google-calendar",
      type: "google_calendar",
    });
    const gcalCredential = await CredentialRepository.create(gcalCredentialData);

    const gCalService = createGoogleCalendarServiceWithGoogleType({
      ...gcalCredential,
      user: null,
      delegatedTo: null,
    });

    const calendar = new calendar_v3.Calendar({
      auth: oAuth2Client,
    });

    const primaryCal = await gCalService.getPrimaryCalendar(calendar);

    // If we still don't have a primary calendar skip creating the selected calendar.
    // It can be toggled on later.
    if (!primaryCal?.id) {
      res.redirect(
        getSafeRedirectUrl(state?.returnTo) ??
          getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
      );
      return;
    }

    // Only attempt to update the user's profile photo if the user has granted the required scope
    if (grantedScopes.includes(SCOPE_USERINFO_PROFILE)) {
      await updateProfilePhotoGoogle(oAuth2Client, req.session.user.id);
    }

    const selectedCalendarWhereUnique = {
      userId: req.session.user.id,
      externalId: primaryCal.id,
      integration: "google_calendar",
    };

    // Wrapping in a try/catch to reduce chance of race conditions-
    // also this improves performance for most of the happy-paths.
    try {
      await gCalService.upsertSelectedCalendar({
        // First install should add a user-level selectedCalendar only.
        eventTypeId: null,
        externalId: selectedCalendarWhereUnique.externalId,
      });
    } catch (error) {
      let errorMessage = "something_went_wrong";
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // it is possible a selectedCalendar was orphaned, in this situation-
        // we want to recover by connecting the existing selectedCalendar to the new Credential.
        if (await renewSelectedCalendarCredentialId(selectedCalendarWhereUnique, gcalCredential.id)) {
          res.redirect(
            getSafeRedirectUrl(state?.returnTo) ??
              getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
          );
          return;
        }
        // else
        errorMessage = "account_already_linked";
      }
      await CredentialRepository.deleteById({ id: gcalCredential.id });
      res.redirect(
        `${
          getSafeRedirectUrl(state?.onErrorReturnTo) ??
          getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
        }?error=${errorMessage}`
      );
      return;
    }
  }

  // No need to install? Redirect to the returnTo URL
  if (!state?.installGoogleVideo) {
    res.redirect(
      getSafeRedirectUrl(state?.returnTo) ??
        getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
    );
    return;
  }

  const existingGoogleMeetCredential = await CredentialRepository.findFirstByUserIdAndType({
    userId: req.session.user.id,
    type: "google_video",
  });

  // If the user already has a google meet credential, there's nothing to do in here
  if (existingGoogleMeetCredential) {
    res.redirect(
      getSafeRedirectUrl(`${WEBAPP_URL}/apps/installed/conferencing?hl=google-meet`) ??
        getInstalledAppPath({ variant: "conferencing", slug: "google-meet" })
    );
    return;
  }

  // Create a new google meet credential
  const googleMeetCredentialData = buildCredentialCreateData({
    userId: req.session.user.id,
    type: "google_video",
    key: {},
    appId: "google-meet",
  });
  await CredentialRepository.create(googleMeetCredentialData);
  res.redirect(
    getSafeRedirectUrl(`${WEBAPP_URL}/apps/installed/conferencing?hl=google-meet`) ??
      getInstalledAppPath({ variant: "conferencing", slug: "google-meet" })
  );
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(getHandler) }),
});

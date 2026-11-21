import { GOOGLE_CALENDAR_SCOPES, SCOPE_USERINFO_PROFILE, WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { HttpError } from "@calcom/lib/http-error";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import { OAuth2Client } from "googleapis-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { startBrowserOAuth } from "../lib/browserOAuth";
import { getGoogleAppKeys } from "../lib/getGoogleAppKeys";

async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const loggedInUser = req.session?.user;

  if (!loggedInUser?.id) {
    throw new HttpError({ statusCode: 401, message: "You must be logged in to do this" });
  }

  // Ideally this should never happen, as email is there in session user but typings aren't accurate it seems
  // TODO: So, confirm and later fix the typings
  if (!loggedInUser.email) {
    throw new HttpError({ statusCode: 400, message: "Session user must have an email" });
  }

  const { client_id, client_secret } = await getGoogleAppKeys();
  const redirect_uri = `${WEBAPP_URL_FOR_OAUTH}/api/integrations/googlecalendar/callback`;
  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uri);

  const { state, codeChallenge } = startBrowserOAuth(req, res);
  const authUrl = new URL(
    oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [SCOPE_USERINFO_PROFILE, ...GOOGLE_CALENDAR_SCOPES],
      // Renewals require offline consent, and private hosts may want another Google account.
      prompt: process.env.CAL_PRIVATE_INSTANCE === "true" ? "select_account consent" : "consent",
      state,
    })
  );
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.status(200).json({ url: authUrl.toString() });
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(getHandler) }),
});

import process from "node:process";

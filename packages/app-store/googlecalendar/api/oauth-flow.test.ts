import { createHash } from "node:crypto";
import { WEBAPP_URL } from "@calcom/lib/constants";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import add from "./add";
import callback from "./callback";

const mocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  create: vi.fn(),
  getPrimaryCalendar: vi.fn(),
  upsertSelectedCalendar: vi.fn(),
  getCalendar: vi.fn(),
  getGoogleIdentity: vi.fn(),
  savePrivateGoogleConnection: vi.fn(),
}));
vi.mock("googleapis-common", () => ({
  OAuth2Client: class {
    generateAuthUrl = mocks.generateAuthUrl;
    getToken = mocks.getToken;
    setCredentials = vi.fn();
  },
}));
vi.mock("@googleapis/calendar", () => ({
  calendar_v3: {
    Calendar: class {
      calendars = { get: mocks.getCalendar };
    },
  },
}));
vi.mock("@googleapis/oauth2", () => ({
  oauth2_v2: {
    Oauth2: class {
      userinfo = { get: mocks.getGoogleIdentity };
    },
  },
}));
vi.mock("../lib/privateConnection", () => ({
  savePrivateGoogleConnection: mocks.savePrivateGoogleConnection,
}));
vi.mock("../lib/getGoogleAppKeys", () => ({
  getGoogleAppKeys: async () => ({ client_id: "client", client_secret: "fixture" }),
}));
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: () => ({
    getPrimaryCalendar: mocks.getPrimaryCalendar,
    upsertSelectedCalendar: mocks.upsertSelectedCalendar,
  }),
}));
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: { create: mocks.create },
}));
vi.mock("../../_utils/oauth/updateProfilePhotoGoogle", () => ({ updateProfilePhotoGoogle: vi.fn() }));
vi.mock("@calcom/lib/server/defaultResponder", () => ({
  defaultResponder: (handler: unknown) => handler,
}));

function makeRequest(
  userId: number,
  query: NextApiRequest["query"] = {},
  cookies: NextApiRequest["cookies"] = {}
) {
  return Object.assign(mockDeep<NextApiRequest>(), {
    method: "GET",
    query,
    cookies,
    session: { user: { id: userId, email: "fixture@example.test" }, expires: "2027-01-01" },
  });
}

function makeResponse() {
  const response = mockDeep<NextApiResponse>();
  response.status.mockReturnValue(response);
  return response;
}

async function startFlow(userId = 1) {
  const res = makeResponse();
  await add(
    makeRequest(userId, { state: JSON.stringify({ fromApp: true, returnTo: WEBAPP_URL + "/availability" }) }),
    res
  );
  const [{ state }] = mocks.generateAuthUrl.mock.lastCall ?? [];
  const url = new URL(res.json.mock.lastCall?.[0]?.url);
  expect(typeof state).toBe("string");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const cookieValue = res.setHeader.mock.calls.find(([name]) => name.toLowerCase() === "set-cookie")?.[1];
  const cookie = (Array.isArray(cookieValue) ? cookieValue.at(-1) : cookieValue)?.toString();
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  const [name, value] = cookie!.split(";")[0].split("=");
  return { state, challenge: url.searchParams.get("code_challenge"), cookies: { [name]: value } };
}

describe("Google Calendar OAuth browser flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", "isolated-signing-test-secret");
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "false");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T16:00:00Z"));
    mocks.generateAuthUrl.mockReturnValue("https://accounts.google.test/authorize");
    mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        scope:
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
      },
    });
    mocks.getPrimaryCalendar.mockResolvedValue({ id: "fixture-google@example.test" });
    mocks.create.mockResolvedValue({ id: 123, userId: 1, type: "google_calendar" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    undefined,
    "not-a-valid-state",
    "{}",
  ])("rejects missing or invalid state before exchanging the code", async (state) => {
    await expect(callback(makeRequest(1, { code: "code", state }), makeResponse())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires both the initiating CAL account and its browser cookie", async () => {
    const flow = await startFlow();
    for (const req of [
      makeRequest(2, { code: "code", state: flow.state }, flow.cookies),
      makeRequest(1, { code: "code", state: flow.state }),
    ]) {
      await expect(callback(req, makeResponse())).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("rejects tampering and an expired flow before contacting Google", async () => {
    const flow = await startFlow();
    const [encoded, signature] = flow.state.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.options.installGoogleVideo = true;
    const modified = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + signature;
    await expect(
      callback(makeRequest(1, { code: "code", state: modified }, flow.cookies), makeResponse())
    ).rejects.toMatchObject({ statusCode: 400 });
    vi.setSystemTime(new Date("2026-11-15T16:16:00Z"));
    await expect(
      callback(makeRequest(1, { code: "code", state: flow.state }, flow.cookies), makeResponse())
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("redirects a cancelled consent flow without exchanging a code", async (code) => {
    const flow = await startFlow();
    const res = makeResponse();
    await callback(makeRequest(1, { state: flow.state, error: "access_denied", code }, flow.cookies), res);
    expect(res.redirect).toHaveBeenCalledWith(WEBAPP_URL + "/availability");
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("starts a direct install with secure state when the caller has no optional settings", async () => {
    const res = makeResponse();
    await add(makeRequest(1), res);
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.any(String) })
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("exchanges the code with the matching verifier and completes the existing calendar setup", async () => {
    const flow = await startFlow();
    const res = makeResponse();
    await callback(makeRequest(1, { state: flow.state, code: "google-code" }, flow.cookies), res);
    const [{ code, codeVerifier }] = mocks.getToken.mock.lastCall ?? [];
    expect(code).toBe("google-code");
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(flow.challenge);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.upsertSelectedCalendar).toHaveBeenCalledWith({
      eventTypeId: null,
      externalId: "fixture-google@example.test",
    });
    expect(res.redirect).toHaveBeenCalledWith(WEBAPP_URL + "/availability");
  });

  it("verifies the Google account ID separately from the primary calendar", async () => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
    mocks.getCalendar.mockResolvedValue({ data: { id: "private-google@example.test" } });
    mocks.getGoogleIdentity.mockResolvedValue({ data: { id: "google-account-1" } });
    const flow = await startFlow();
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: "offline", prompt: "select_account consent" })
    );
    const res = makeResponse();
    await callback(makeRequest(1, { state: flow.state, code: "google-code" }, flow.cookies), res);
    expect(mocks.getCalendar).toHaveBeenCalledWith({ calendarId: "primary", fields: "id" });
    expect(mocks.getGoogleIdentity).toHaveBeenCalledWith({ fields: "id" });
    expect(mocks.savePrivateGoogleConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        googleAccountId: "google-account-1",
        primaryCalendarId: "private-google@example.test",
        tokens: expect.objectContaining({ refresh_token: "fixture-refresh" }),
      })
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(WEBAPP_URL + "/availability");
  });

  it("rejects private consent without an offline grant before changing the connection", async () => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
    const { tokens } = await mocks.getToken();
    mocks.getToken.mockResolvedValue({ tokens: { ...tokens, refresh_token: null } });
    const flow = await startFlow();
    await expect(
      callback(makeRequest(1, { state: flow.state, code: "google-code" }, flow.cookies), makeResponse())
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.savePrivateGoogleConnection).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("leaves connections untouched when Google does not return a verified account ID", async () => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
    mocks.getCalendar.mockResolvedValue({ data: { id: "private-google@example.test" } });
    mocks.getGoogleIdentity.mockResolvedValue({ data: {} });
    const flow = await startFlow();
    await expect(
      callback(makeRequest(1, { state: flow.state, code: "google-code" }, flow.cookies), makeResponse())
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(mocks.savePrivateGoogleConnection).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

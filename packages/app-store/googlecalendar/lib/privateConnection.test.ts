import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePrivateGoogleConnection, updateCurrentPrivateGoogleGrant } from "./privateConnection";
import { readPrivateGoogleGrant, sealPrivateGoogleGrant } from "./privateGrantStorage";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  credential: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  selectedCalendar: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("@calcom/prisma", () => ({ default: db }));
const primary = "primary@example.test";
const googleAccount = "fixture-google-id";
const newTokens = { access_token: "new-access", refresh_token: "new-refresh" };
const oldKey = { access_token: "old-access", refresh_token: "old-refresh" };
const credential = { id: 42, key: oldKey };
const resolveLegacyAccount = vi.fn();

function connect(googleAccountId = googleAccount, primaryCalendarId = primary) {
  return savePrivateGoogleConnection({
    userId: 1,
    googleAccountId,
    primaryCalendarId,
    tokens: newTokens,
    resolveLegacyAccount,
  });
}

describe("private Google Calendar connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "fixture-grant-secret-32-bytes---");
    db.$transaction.mockImplementation((transaction: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      transaction(prisma)
    );
    db.$queryRaw.mockResolvedValue([{ id: 1 }]);
    db.credential.findMany.mockResolvedValue([]);
    db.credential.updateMany.mockResolvedValue({ count: 1 });
    db.selectedCalendar.updateMany.mockResolvedValue({ count: 0 });
    resolveLegacyAccount.mockResolvedValue(googleAccount);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("renews a verified legacy grant in place without touching calendar associations", async () => {
    db.credential.findMany.mockResolvedValue([credential]);
    await connect();
    expect(resolveLegacyAccount).toHaveBeenCalledWith(oldKey);
    expect(db.credential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, type: "google_calendar", teamId: null, delegationCredentialId: null },
      })
    );
    expect(db.credential.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 42, userId: 1, key: { equals: oldKey } }),
      data: expect.objectContaining({
        encryptedKey: null,
        invalid: false,
      }),
    });
    const saved = db.credential.updateMany.mock.lastCall?.[0].data.key;
    expect(JSON.stringify(saved)).not.toContain(newTokens.refresh_token);
    expect(readPrivateGoogleGrant(saved, 1)).toMatchObject({
      ...newTokens,
      calGoogleAccountId: googleAccount,
      calGoogleGrantVersion: expect.any(String),
    });
    expect(db.credential.create).not.toHaveBeenCalled();
    expect(db.selectedCalendar.updateMany).not.toHaveBeenCalled();
    expect(db.selectedCalendar.create).not.toHaveBeenCalled();
  });

  it("can renew an expired grant with a verified identity even if the primary calendar changed", async () => {
    db.credential.findMany.mockResolvedValue([
      { ...credential, key: { ...oldKey, calGoogleAccountId: googleAccount } },
    ]);
    await connect(googleAccount, "renamed-primary@example.test");
    expect(resolveLegacyAccount).not.toHaveBeenCalled();
    expect(db.credential.updateMany).toHaveBeenCalledOnce();
    expect(db.selectedCalendar.create).not.toHaveBeenCalled();
  });

  it("adds a verified distinct account and selects its primary calendar", async () => {
    db.credential.findMany.mockResolvedValue([credential]);
    db.credential.create.mockResolvedValue({ id: 99 });
    const secondPrimary = "second@example.test";
    await connect("second-google-id", secondPrimary);
    expect(db.credential.updateMany).not.toHaveBeenCalled();
    const saved = db.credential.create.mock.lastCall?.[0].data.key;
    expect(JSON.stringify(saved)).not.toContain(newTokens.access_token);
    expect(readPrivateGoogleGrant(saved, 1)).toMatchObject(newTokens);
    expect(db.selectedCalendar.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 1,
          integration: "google_calendar",
          externalId: secondPrimary,
          credentialId: 99,
          eventTypeId: null,
        },
      })
    );
  });

  it("uses a sealed connection without sending ciphertext to the legacy identity resolver", async () => {
    const sealed = sealPrivateGoogleGrant({ ...oldKey, calGoogleAccountId: googleAccount }, 1);
    db.credential.findMany.mockResolvedValue([{ id: credential.id, key: sealed }]);
    await connect();
    expect(resolveLegacyAccount).not.toHaveBeenCalled();
    expect(db.credential.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects a different account if a legacy grant cannot be identified", async () => {
    db.credential.findMany.mockResolvedValue([credential]);
    resolveLegacyAccount.mockResolvedValue(null);
    await expect(connect()).rejects.toMatchObject({ statusCode: 409 });
    expect(db.credential.create).not.toHaveBeenCalled();
    expect(db.credential.updateMany).not.toHaveBeenCalled();
  });

  it("rejects two grants with the same verified identity", async () => {
    db.credential.findMany.mockResolvedValue([credential, { ...credential, id: 43 }]);
    await expect(connect()).rejects.toMatchObject({ statusCode: 409 });
    expect(db.credential.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a callback if another has already connected the account", async () => {
    db.credential.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([credential]);
    await expect(connect()).rejects.toMatchObject({ statusCode: 409 });
    expect(db.credential.create).not.toHaveBeenCalled();
  });

  it("rejects renewal when the stored grant changes after it was read", async () => {
    db.credential.findMany.mockResolvedValue([credential]);
    db.credential.updateMany.mockResolvedValue({ count: 0 });
    await expect(connect()).rejects.toMatchObject({ statusCode: 409 });
    expect(db.credential.create).not.toHaveBeenCalled();
  });

  it("conditions token refresh, expiry, and invalidation on the initiating grant", async () => {
    db.credential.updateMany.mockResolvedValue({ count: 0 });
    const snapshot = { ...credential, userId: 1 };
    for (const data of [{ key: newTokens }, { key: { ...oldKey, expiry_date: 1 } }, { invalid: true }]) {
      await expect(updateCurrentPrivateGoogleGrant(prisma, snapshot, data)).resolves.toBe(false);
      expect(db.credential.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: 42,
          userId: 1,
          type: "google_calendar",
          teamId: null,
          delegationCredentialId: null,
          key: { equals: oldKey },
        },
        data,
      });
    }
  });
});

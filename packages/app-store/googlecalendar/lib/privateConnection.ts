import { randomUUID } from "node:crypto";
import { HttpError } from "@calcom/lib/http-error";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { readPrivateGoogleGrant, sealPrivateGoogleGrant } from "./privateGrantStorage";

const type = "google_calendar";
const appId = "google-calendar";

function personalGoogleCredentials(userId: number) {
  return { userId, type, teamId: null, delegationCredentialId: null };
}

function readString(key: Prisma.JsonValue, property: string) {
  const value = key && typeof key === "object" && !Array.isArray(key) ? key[property] : null;
  return typeof value === "string" && value ? value : null;
}

export async function updateCurrentPrivateGoogleGrant(
  db: Pick<Prisma.TransactionClient, "credential">,
  credential: { userId: number; id: number; key: Prisma.JsonValue },
  data: { key?: Prisma.InputJsonObject; encryptedKey?: string | null; invalid?: boolean }
) {
  const { count } = await db.credential.updateMany({
    where: {
      ...personalGoogleCredentials(credential.userId),
      id: credential.id,
      key: { equals: credential.key ?? Prisma.JsonNull },
    },
    data,
  });
  return count === 1;
}

export async function savePrivateGoogleConnection({
  userId,
  googleAccountId,
  primaryCalendarId,
  tokens,
  resolveLegacyAccount,
}: {
  userId: number;
  googleAccountId: string;
  primaryCalendarId: string;
  tokens: Prisma.InputJsonObject;
  resolveLegacyAccount: (key: Prisma.JsonValue) => Promise<string | null>;
}) {
  const query = {
    where: personalGoogleCredentials(userId),
    select: { id: true, key: true },
    orderBy: { id: "asc" },
  } satisfies Prisma.CredentialFindManyArgs;
  const observed = (await prisma.credential.findMany(query)).map(({ id, key }) => ({
    id,
    grant: readPrivateGoogleGrant(key, userId),
  }));
  const identities = await Promise.all(
    observed.map(({ grant }) => readString(grant, "calGoogleAccountId") ?? resolveLegacyAccount(grant))
  );
  const matches = observed.filter((_, index) => identities[index] === googleAccountId);
  if (matches.length > 1 || (!matches.length && identities.includes(null))) {
    throw new HttpError({
      statusCode: 409,
      message: "CAL could not verify which Google connection to use. Existing connections were preserved.",
    });
  }

  const key = sealPrivateGoogleGrant(
    {
      ...tokens,
      calGoogleAccountId: googleAccountId,
      calGoogleGrantVersion: randomUUID(),
    },
    userId
  );
  const concurrentChange = () =>
    new HttpError({ statusCode: 409, message: "Google connections changed. Start again from CAL." });

  await prisma.$transaction(async (tx) => {
    // Keep provider requests outside the transaction and serialize callback writes per host.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.credential.findMany(query);
    if (
      current.length !== observed.length ||
      current.some(({ id, key }, index) => {
        const original = observed[index];
        const grant = readPrivateGoogleGrant(key, userId);
        return (
          id !== original.id ||
          readString(grant, "calGoogleGrantVersion") !==
            readString(original.grant, "calGoogleGrantVersion") ||
          readString(grant, "calGoogleAccountId") !== readString(original.grant, "calGoogleAccountId") ||
          (readString(grant, "refresh_token") ?? readString(grant, "access_token")) !==
            (readString(original.grant, "refresh_token") ?? readString(original.grant, "access_token"))
        );
      })
    ) {
      throw concurrentChange();
    }

    const existing = current.find(({ id }) => id === matches[0]?.id);
    if (existing) {
      const updated = await updateCurrentPrivateGoogleGrant(
        tx,
        { ...existing, userId },
        {
          key,
          encryptedKey: null,
          invalid: false,
        }
      );
      if (!updated) throw concurrentChange();
      return;
    }

    const credential = await tx.credential.create({
      data: { userId, appId, type, key },
      select: { id: true },
    });
    const selectedCalendar = { userId, integration: type, externalId: primaryCalendarId };
    await tx.selectedCalendar.updateMany({
      where: { ...selectedCalendar, credentialId: null },
      data: { credentialId: credential.id },
    });
    const selected = await tx.selectedCalendar.findFirst({
      where: { ...selectedCalendar, credentialId: credential.id, eventTypeId: null },
      select: { id: true },
    });
    if (!selected) {
      await tx.selectedCalendar.create({
        data: { ...selectedCalendar, credentialId: credential.id, eventTypeId: null },
        select: { id: true },
      });
    }
  });
}

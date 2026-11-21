import prisma from "@calcom/prisma";
import { bookingPageAppearanceSchema } from "@calcom/prisma/bookingPageAppearanceSchema";
import { z } from "zod";

const metadata = z
  .object({ bookingPageAppearance: bookingPageAppearanceSchema.optional().nullable() })
  .nullable();

export async function getBookingDetailsAppearance({
  ownerId,
  isPersonal,
}: {
  ownerId?: number;
  isPersonal: boolean;
}) {
  if (!isPersonal || !ownerId) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { metadata: true } });
  const parsed = metadata.safeParse(owner?.metadata);
  return parsed.success ? (parsed.data?.bookingPageAppearance ?? null) : null;
}

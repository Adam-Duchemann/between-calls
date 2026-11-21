import process from "node:process";
import type { Prisma } from "@calcom/prisma/client";

const personalEventWhere = {
  teamId: null,
  parentId: null,
  profileId: null,
  schedulingType: null,
  seatsPerTimeSlot: null,
} satisfies Prisma.EventTypeWhereInput;

export function privatePublicEventWhere() {
  return process.env.CAL_PRIVATE_INSTANCE === "true" ? personalEventWhere : {};
}

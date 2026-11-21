import process from "node:process";
import { getDefaultEvent } from "@calcom/features/eventtypes/lib/defaultEvents";
import { privatePublicEventWhere } from "@calcom/features/eventtypes/lib/privatePublicEventWhere";
import { HttpError } from "@calcom/lib/http-error";
import { withReporting } from "@calcom/lib/sentryWrapper";

import { getBookingFieldsWithSystemFields } from "../getBookingFields";
import { getEventTypesFromDB } from "./getEventTypesFromDB";

const _getEventType = async ({
  eventTypeId,
  eventTypeSlug,
}: {
  eventTypeId: number;
  eventTypeSlug?: string;
}) => {
  if (!eventTypeId && !eventTypeSlug) {
    throw new HttpError({ statusCode: 400, message: "Either eventTypeId or eventTypeSlug must be provided" });
  }

  if (process.env.CAL_PRIVATE_INSTANCE === "true" && !eventTypeId) {
    throw new HttpError({ statusCode: 404, message: "Event type not found" });
  }

  // handle dynamic user
  const eventType =
    !eventTypeId && !!eventTypeSlug
      ? getDefaultEvent(eventTypeSlug)
      : await getEventTypesFromDB(eventTypeId, privatePublicEventWhere());

  const isOrgTeamEvent = !!eventType?.team && !!eventType?.team?.parentId;

  return {
    ...eventType,
    bookingFields: getBookingFieldsWithSystemFields({ ...eventType, isOrgTeamEvent }),
  };
};

export const getEventType = withReporting(_getEventType, "getEventType");

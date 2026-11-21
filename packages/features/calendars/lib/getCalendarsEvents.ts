import process from "node:process";
import { getCalendar } from "@calcom/app-store/_utils/getCalendar";
import { symmetricDecrypt } from "@calcom/lib/crypto";
import { decryptSecret } from "@calcom/lib/crypto/keyring";
import { isDelegationCredential } from "@calcom/lib/delegationCredential";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import { getPiiFreeCredential, getPiiFreeSelectedCalendar } from "@calcom/lib/piiFreeData";
import { safeStringify } from "@calcom/lib/safeStringify";
import { performance } from "@calcom/lib/server/perfObserver";
import type {
  Calendar,
  CalendarFetchMode,
  EventBusyDate,
  IntegrationCalendar,
  SelectedCalendar,
} from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";
import { normalizeTimezone } from "./timezone-conversion";

const log = logger.getSubLogger({ prefix: ["getCalendarsEvents"] });

const CALENDSO_ENCRYPTION_KEY = process.env.CALENDSO_ENCRYPTION_KEY || "";

type CalendarConnection = readonly [Calendar | null, CredentialForCalendarService];

function assertSelectedGoogleConnectionsValid(
  credentials: CredentialForCalendarService[],
  selections: SelectedCalendar[]
) {
  const google = credentials.filter((credential) => credential.type === "google_calendar");
  for (const selection of selections) {
    if (selection.integration !== "google_calendar") continue;

    const matchingConnections = google.filter((credential) =>
      selection.credentialId === null
        ? credential.userId === selection.userId
        : credential.id === selection.credentialId
    );
    // A legacy selection can still be checked by a working connection for the same owner.
    if (matchingConnections.length > 0 && matchingConnections.every((credential) => credential.invalid)) {
      throw ErrorWithCode.Factory.InternalServerError("Selected Google calendar connection is invalid");
    }
  }
}

async function resolveLegacyGoogleSelections(
  selections: SelectedCalendar[],
  connections: CalendarConnection[]
): Promise<SelectedCalendar[]> {
  const isLegacyGoogle = (selection: SelectedCalendar) =>
    selection.integration === "google_calendar" &&
    selection.credentialId === null &&
    selection.externalId !== "primary";
  if (!selections.some(isLegacyGoogle)) return selections;

  const google = connections.filter(
    (connection): connection is readonly [Calendar, CredentialForCalendarService] =>
      !!connection[0] &&
      connection[1].type === "google_calendar" &&
      !isDelegationCredential({ credentialId: connection[1].id })
  );
  const inventories = new Map<number, Promise<IntegrationCalendar[]>>();
  return Promise.all(
    selections.map(async (selection) => {
      if (!isLegacyGoogle(selection)) return selection;
      const accounts = google.filter(([, credential]) => credential.userId === selection.userId);
      if (accounts.length < 2) return selection;

      // A legacy selection can outlive the account that first added it.
      const visible = await Promise.allSettled(
        accounts.map(async ([service, credential]) => {
          let calendars = inventories.get(credential.id);
          if (!calendars) {
            calendars = service.listCalendars();
            inventories.set(credential.id, calendars);
          }
          return (await calendars).some(({ externalId }) => externalId === selection.externalId)
            ? credential.id
            : null;
        })
      );
      for (const result of visible) {
        if (result.status === "fulfilled" && result.value !== null) {
          return { ...selection, credentialId: result.value };
        }
      }
      throw ErrorWithCode.Factory.InternalServerError("Google calendar selection could not be verified");
    })
  );
}

// only for Google Calendar for now
export const getCalendarsEventsWithTimezones = async (
  withCredentials: CredentialForCalendarService[],
  dateFrom: string,
  dateTo: string,
  selectedCalendars: SelectedCalendar[]
): Promise<(EventBusyDate & { timeZone: string })[][]> => {
  assertSelectedGoogleConnectionsValid(withCredentials, selectedCalendars);
  const calendarCredentials = withCredentials
    .filter((credential) => credential.type === "google_calendar")
    // filter out invalid credentials - these won't work.
    .filter((credential) => !credential.invalid);

  const calendarAndCredentialPairs = await Promise.all(
    calendarCredentials.map(async (credential) => {
      const calendar = await getCalendar(credential, "slots");
      return [calendar, credential] as const;
    })
  );

  const selections = await resolveLegacyGoogleSelections(selectedCalendars, calendarAndCredentialPairs);
  const results = calendarAndCredentialPairs.map(async ([c, credential]) => {
    /** Filter out nulls */
    if (!c) return [];
    const passedSelectedCalendars = filterSelectedCalendarsForCredential(selections, credential);
    const isADelegationCredential = isDelegationCredential({ credentialId: credential.id });
    // We want to fallback to primary calendar when no selectedCalendars are passed
    // Default behaviour for Google Calendar is to use all available calendars, which isn't good default.
    const allowFallbackToPrimary = isADelegationCredential;
    if (!passedSelectedCalendars.length) {
      if (!isADelegationCredential) {
        // It was done to fix the secondary calendar connections from always checking the conflicts even if intentional no calendars are selected.
        // https://github.com/calcom/cal.diy/issues/8929
        log.error(
          `No selected calendars for non DWD credential: Skipping getAvailability call for credential ${credential?.id}`
        );
        return [];
      }
      // For delegation credential, we should allow getAvailability even without any selected calendars. It ensures that enabling Delegation Credential at Organization level always ensure one selected calendar for conflicts checking, without requiring any manual action from organization members
      // This is also, similar to how Google Calendar connect flow(through /googlecalendar/api/callback) sets the primary calendar as the selected calendar automatically.
      log.info("Allowing getAvailability even without any selected calendars for Delegation Credential");
    }
    /** We extract external Ids so we don't cache too much */
    const eventBusyDates =
      (await c.getAvailabilityWithTimeZones?.({
        dateFrom,
        dateTo,
        selectedCalendars: passedSelectedCalendars,
        mode: "slots",
        fallbackToPrimary: allowFallbackToPrimary,
      })) || [];

    return eventBusyDates.map((event) => ({
      ...event,
      timeZone: normalizeTimezone(event.timeZone),
    }));
  });
  const awaitedResults = await Promise.all(results);
  return awaitedResults;
};

const getCalendarsEvents = async (
  withCredentials: CredentialForCalendarService[],
  dateFrom: string,
  dateTo: string,
  selectedCalendars: SelectedCalendar[],
  mode: CalendarFetchMode
): Promise<EventBusyDate[][]> => {
  if (mode === "slots" || mode === "booking") {
    assertSelectedGoogleConnectionsValid(withCredentials, selectedCalendars);
  }
  const calendarCredentials = withCredentials
    .filter((credential) => credential.type.endsWith("_calendar"))
    // filter out invalid credentials - these won't work.
    .filter((credential) => !credential.invalid);

  const calendarAndCredentialPairs = await Promise.all(
    calendarCredentials.map(async (credential) => {
      let key: typeof credential.key;
      try {
        if (credential.encryptedKey) {
          key = JSON.parse(
            decryptSecret({
              envelope: JSON.parse(credential.encryptedKey),
              aad: { type: credential.type },
            })
          );
        } else {
          key = credential.key;
        }
      } catch {
        log.warn("Failed to decrypt credential key, falling back to legacy key", {
          credentialId: credential.id,
        });
        key = credential.key;
      }

      const calendar = await getCalendar(
        {
          ...credential,
          // use encrypted secret to get unencrypted calendar creds
          key,
        },
        mode
      );
      return [calendar, credential] as const;
    })
  );

  const selections = await resolveLegacyGoogleSelections(selectedCalendars, calendarAndCredentialPairs);
  performance.mark("getBusyCalendarTimesStart");
  const results = calendarAndCredentialPairs.map(async ([calendarService, credential]) => {
    /** Filter out nulls */
    if (!calendarService) return [];
    const { appId } = credential;
    const passedSelectedCalendars = filterSelectedCalendarsForCredential(selections, credential);
    const isADelegationCredential = isDelegationCredential({ credentialId: credential.id });
    // We want to fallback to primary calendar when no selectedCalendars are passed
    // Default behaviour for Google Calendar is to use all available calendars, which isn't good default.
    const allowFallbackToPrimary = isADelegationCredential;
    if (!passedSelectedCalendars.length) {
      if (!isADelegationCredential) {
        // It was done to fix the secondary calendar connections from always checking the conflicts even if intentional no calendars are selected.
        // https://github.com/calcom/cal.diy/issues/8929
        log.error(
          `No selected calendars for non DWD credential: Skipping getAvailability call for credential ${credential?.id}`
        );
        return [];
      }
      // For delegation credential, we should allow getAvailability even without any selected calendars. It ensures that enabling Delegation Credential at Organization level always ensure one selected calendar for conflicts checking, without requiring any manual action from organization members
      // This is also, similar to how Google Calendar connect flow(through /googlecalendar/api/callback) sets the primary calendar as the selected calendar automatically.
      log.info("Allowing getAvailability even without any selected calendars for Delegation Credential");
    }
    /** We extract external Ids so we don't cache too much */

    const selectedCalendarIds = passedSelectedCalendars.map((sc) => sc.externalId);
    /** If we don't then we actually fetch external calendars (which can be very slow) */
    performance.mark("eventBusyDatesStart");
    log.debug(
      `Getting availability for`,
      safeStringify({
        calendarService: calendarService.constructor.name,
        selectedCalendars: passedSelectedCalendars.map(getPiiFreeSelectedCalendar),
      })
    );
    const availabilityParams = {
      dateFrom,
      dateTo,
      selectedCalendars: passedSelectedCalendars,
      mode,
      fallbackToPrimary: allowFallbackToPrimary,
    };
    // "overlay" mode is only used when the calendar owner looks at their own calendars, so titles can be included.
    // Titles are a nice-to-have, losing them must never cost the owner their busy times.
    const eventBusyDates =
      mode === "overlay" && calendarService.getAvailabilityWithTitles
        ? await calendarService.getAvailabilityWithTitles(availabilityParams).catch((error) => {
            log.warn(
              "getAvailabilityWithTitles failed, falling back to getAvailability",
              safeStringify({ credentialId: credential?.id, error })
            );
            return calendarService.getAvailability(availabilityParams);
          })
        : await calendarService.getAvailability(availabilityParams);
    performance.mark("eventBusyDatesEnd");
    performance.measure(
      `[getAvailability for ${selectedCalendarIds.join(", ")}][$1]'`,
      "eventBusyDatesStart",
      "eventBusyDatesEnd"
    );

    return eventBusyDates.map((a) => ({
      ...a,
      source: `${appId}`,
    }));
  });
  const awaitedResults = await Promise.all(results);
  performance.mark("getBusyCalendarTimesEnd");
  performance.measure(
    `getBusyCalendarTimes took $1 for creds ${calendarCredentials.map((cred) => cred.id)}`,
    "getBusyCalendarTimesStart",
    "getBusyCalendarTimesEnd"
  );
  log.debug(
    "Result",
    safeStringify({
      calendarCredentials: calendarCredentials.map(getPiiFreeCredential),
      selectedCalendars: selectedCalendars.map(getPiiFreeSelectedCalendar),
      calendarEvents: awaitedResults,
    })
  );
  return awaitedResults;
};

export default getCalendarsEvents;

/**
 * Extract server URL from CalDAV calendar externalId
 */
function getServerUrlFromCalendarExternalId(externalId: string): string | null {
  try {
    const url = new URL(externalId);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Extract server URL from CalDAV credential
 */
function getServerUrlFromCredential(credential: CredentialForCalendarService): string | null {
  try {
    if (credential.type !== "caldav_calendar") {
      return null;
    }

    const decryptedData = JSON.parse(symmetricDecrypt(credential.key as string, CALENDSO_ENCRYPTION_KEY));

    if (!decryptedData.url) {
      return null;
    }

    const url = new URL(decryptedData.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Filter selected calendars for the specific credential, handling CalDAV server URL matching
 */
export function filterSelectedCalendarsForCredential(
  selectedCalendars: SelectedCalendar[],
  credential: CredentialForCalendarService
): SelectedCalendar[] {
  const { type } = credential;

  // A delegated connection can stand in for a removed regular connection in CalendarManager.
  if (type === "google_calendar" && !isDelegationCredential({ credentialId: credential.id })) {
    return selectedCalendars.filter(
      (selection) =>
        selection.integration === type &&
        (selection.credentialId === credential.id ||
          (selection.credentialId === null && selection.userId === credential.userId))
    );
  }

  // For all other calendar types, use the existing logic
  if (type !== "caldav_calendar") {
    return selectedCalendars.filter((sc) => sc.integration === type);
  }

  const credentialServerUrl = getServerUrlFromCredential(credential);

  if (!credentialServerUrl) {
    log.warn("Could not extract server URL from CalDAV credential", {
      credentialId: credential.id,
    });
    return [];
  }

  return selectedCalendars.filter((sc) => {
    if (sc.integration !== type) {
      return false;
    }

    const calendarServerUrl = getServerUrlFromCalendarExternalId(sc.externalId);

    if (!calendarServerUrl) {
      log.warn("Could not extract server URL from calendar externalId", {
        externalId: sc.externalId,
        integration: sc.integration,
      });
      return false;
    }

    const matches = credentialServerUrl === calendarServerUrl;

    if (!matches) {
      log.debug("CalDAV calendar server URL does not match credential server URL", {
        credentialId: credential.id,
        credentialServerUrl,
        calendarServerUrl,
        calendarExternalId: sc.externalId,
      });
    }

    return matches;
  });
}

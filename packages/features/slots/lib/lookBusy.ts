import { createHmac } from "node:crypto";
import dayjs from "@calcom/dayjs";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { LookBusyPolicy } from "@calcom/prisma/lookBusySchema";

function monday(date: string) {
  const calendarDate = dayjs.utc(date);
  return calendarDate.subtract((calendarDate.day() + 6) % 7, "day").format("YYYY-MM-DD");
}

export function getLookBusyRange({
  startTime,
  endTime,
  timeZone,
  policy,
}: {
  startTime: string;
  endTime: string;
  timeZone: string;
  policy: LookBusyPolicy;
}) {
  if (policy.mode === "off") return { startTime, endTime };
  const firstDay = dayjs(startTime).tz(timeZone).format("YYYY-MM-DD");
  const lastDay = dayjs(endTime).tz(timeZone).format("YYYY-MM-DD");
  const startDate = policy.mode === "week" ? monday(firstDay) : firstDay;
  const endDate =
    policy.mode === "week" ? dayjs.utc(monday(lastDay)).add(6, "day").format("YYYY-MM-DD") : lastDay;
  const nextDate = dayjs.utc(endDate).add(1, "day").format("YYYY-MM-DD");

  // Resolve each midnight separately: adding 24 hours retains a stale offset across DST.
  return {
    startTime: dayjs.tz(startDate, timeZone).toISOString(),
    endTime: dayjs.tz(nextDate, timeZone).subtract(1, "millisecond").toISOString(),
  };
}

export function selectLookBusySlots<T extends { time: string }>({
  slots,
  policy,
  timeZone,
  eventTypeId,
  ownerId,
  secret,
}: {
  slots: T[];
  policy: LookBusyPolicy;
  timeZone: string;
  eventTypeId: number;
  ownerId: number | null;
  secret: string;
}): T[] {
  if (policy.mode === "off") return slots;
  if (!secret) throw new ErrorWithCode(ErrorCode.InternalServerError, "Look busy requires a server secret");

  const groups = new Map<string, { slot: T; rank: string; instant: string }[]>();
  const seen = new Set<string>();
  for (const slot of slots) {
    const instant = new Date(slot.time).toISOString();
    if (seen.has(instant)) continue;
    seen.add(instant);
    const localDate = dayjs(instant).tz(timeZone).format("YYYY-MM-DD");
    const period = policy.mode === "week" ? monday(localDate) : localDate;
    const rank = createHmac("sha256", secret)
      .update(JSON.stringify(["cal-look-busy-v1", ownerId, eventTypeId, period, instant]))
      .digest("hex");
    const group = groups.get(period) ?? [];
    group.push({ slot, rank, instant });
    groups.set(period, group);
  }

  const selected: T[] = [];
  for (const group of Array.from(groups.values())) {
    const count =
      policy.mode === "percentage"
        ? Math.max(1, Math.round(group.length * (1 - policy.percentage / 100)))
        : policy.count;
    group.sort((a, b) => a.rank.localeCompare(b.rank) || a.instant.localeCompare(b.instant));
    selected.push(...group.slice(0, count).map(({ slot }) => slot));
  }
  return selected.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

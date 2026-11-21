import dayjs from "@calcom/dayjs";
import type { IGetAvailableSlots } from "@calcom/features/bookings/Booker/hooks/useAvailableTimeSlots";
import type { LookBusyPolicy } from "@calcom/prisma/lookBusySchema";
import { getLookBusyRange, selectLookBusySlots } from "./lookBusy";

export async function getOfferedSlots<
  TInput extends { startTime: string; endTime: string; timeZone?: string },
>({
  config,
  input,
  viewerId,
  secret,
  fetchEligible,
}: {
  config: { id: number; ownerId: number | null; timeZone: string; policy: LookBusyPolicy };
  input: TInput;
  viewerId?: number;
  secret: string;
  fetchEligible: (input: TInput) => Promise<IGetAvailableSlots>;
}): Promise<IGetAvailableSlots> {
  if (config.policy.mode === "off" || (viewerId !== undefined && viewerId === config.ownerId)) {
    return fetchEligible(input);
  }

  const range = getLookBusyRange({ ...input, timeZone: config.timeZone, policy: config.policy });
  const eligible = await fetchEligible({ ...input, ...range, timeZone: config.timeZone });
  const selected = selectLookBusySlots({
    slots: Object.values(eligible.slots).flat(),
    policy: config.policy,
    timeZone: config.timeZone,
    eventTypeId: config.id,
    ownerId: config.ownerId,
    secret,
  });
  const slots: IGetAvailableSlots["slots"] = {};
  const start = Date.parse(input.startTime);
  const end = Date.parse(input.endTime);
  for (const slot of selected) {
    const instant = Date.parse(slot.time);
    if (instant < start || instant > end) continue;
    const date = dayjs(slot.time)
      .tz(input.timeZone ?? "UTC")
      .format("YYYY-MM-DD");
    (slots[date] ??= []).push(slot);
  }
  return { ...eligible, slots };
}

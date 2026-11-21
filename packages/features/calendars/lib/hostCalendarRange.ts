import dayjs from "@calcom/dayjs";

export function hostCalendarRange(firstDate: string, timeZone: string) {
  const endDate = new Date(`${firstDate}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  return {
    dateFrom: dayjs.tz(firstDate, timeZone).toISOString(),
    dateTo: dayjs.tz(endDate.toISOString().slice(0, 10), timeZone).toISOString(),
  };
}

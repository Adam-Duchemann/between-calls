type Range = { start: number; end: number };
type StoredHours = { days: number[]; startTime: Date; endTime: Date; date: Date | null };

export function scheduleTimes(hours: StoredHours[]) {
  const weekly: Range[][] = Array.from({ length: 7 }, () => []);
  const overrides = new Map<string, Range[]>();
  for (const row of hours) {
    const start = row.startTime.getUTCHours() * 60 + row.startTime.getUTCMinutes();
    const storedEnd = row.endTime.getUTCHours() * 60 + row.endTime.getUTCMinutes();
    // Cal.diy stores wall-clock values as SQL time; 23:59 is its end-of-day sentinel.
    const end = storedEnd === 1439 ? 1440 : storedEnd;
    const ranges = end > start ? [{ start, end }] : [];
    if (row.date) {
      const date = row.date.toISOString().slice(0, 10);
      overrides.set(date, [...(overrides.get(date) ?? []), ...ranges]);
    } else {
      for (const day of row.days) weekly[day]?.push(...ranges);
    }
  }
  const sort = (ranges: Range[]) => ranges.sort((a, b) => a.start - b.start);
  return {
    weekly: weekly.map(sort),
    overrides: Array.from(overrides, ([date, ranges]) => ({ date, ranges: sort(ranges) })).sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
  };
}

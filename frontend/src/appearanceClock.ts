import {validTime} from "./appearance";

/** Delay to the next local wall-clock boundary; Date handles local DST changes. */
export function nextThemeTransitionDelay(now: Date, dayAt: string, nightAt: string): number {
  if (!validTime(dayAt) || !validTime(nightAt) || dayAt === nightAt) return 60_000;
  const candidates = [dayAt, nightAt].map(time => {
    const candidate = new Date(now.getTime());
    candidate.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      // Set the next calendar date before hours, so a DST-normalized hour does
      // not carry into tomorrow's scheduled local time.
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
    }
    return candidate.getTime() - now.getTime();
  });
  return Math.max(1, Math.min(...candidates));
}

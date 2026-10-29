export type AppearanceMode = "schedule" | "light" | "dark" | "system";
export type DecorName = "plain" | "dots" | "leaves" | "orbits";
export function validTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function scheduledDark(date: Date, night = "19:00", day = "07:00"): boolean {
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const current = date.getHours() * 60 + date.getMinutes();
  const start = minutes(night), end = minutes(day);
  return start > end ? current >= start || current < end : current >= start && current < end;
}
export function resolveDark(mode: AppearanceMode, date: Date, systemDark: boolean, night: string, day: string) {
  return mode === "dark" || (mode === "system" && systemDark) || (mode === "schedule" && scheduledDark(date, night, day));
}

/** "19 Nov 2026": the same in every locale, UTC so a build in another time zone cannot shift the day. */
export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

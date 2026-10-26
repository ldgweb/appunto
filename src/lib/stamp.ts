/** Dates written into the board (F5) and into archive file names. */

/** Short local date and time, like "23/10/26, 14:05". */
export function noteStamp(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/** Sortable local time for file names: "2026-10-23_14-05-09". */
export function fileStamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `_${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`
  );
}

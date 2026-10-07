import { addDays, addMonths, format, parseISO, startOfISOWeek } from 'date-fns';

/** Local calendar date as YYYY-MM-DD. */
export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayISO = () => toISODate(new Date());
export const nowISO = () => new Date().toISOString();
export const nowHHmm = () => format(new Date(), 'HH:mm');

/** "2026-10-07" -> "2026-10" */
export const monthOf = (date: string) => date.slice(0, 7);
export const yearOfDate = (date: string) => Number(date.slice(0, 4));
export const currentMonth = () => monthOf(todayISO());

export function shiftMonth(ym: string, by: number): string {
  return format(addMonths(parseISO(`${ym}-01`), by), 'yyyy-MM');
}

/** Monday of the week containing `date`. */
export const weekStart = (date: string) => toISODate(startOfISOWeek(parseISO(date)));
export const shiftDays = (date: string, by: number) => toISODate(addDays(parseISO(date), by));
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));

/** Week-of-month bucket 0..4 (days 1-7, 8-14, 15-21, 22-28, 29-31). */
export const weekBucket = (date: string) => Math.min(4, Math.floor((Number(date.slice(8, 10)) - 1) / 7));

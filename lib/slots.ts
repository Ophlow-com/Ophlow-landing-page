import { AVAILABILITY } from "./site";

export type Interval = { start: string; end: string };

/** Milliseconds a time zone is ahead of UTC at a given instant (negative west of Greenwich). */
function offsetAt(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** The instant a wall-clock time happens in a time zone, e.g. 09:00 on 2026-11-03 in America/Denver. */
export function zonedToUtc(y: number, m: number, d: number, hhmm: string, timeZone: string) {
  const [h, min] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m, d, h, min);
  const first = guess - offsetAt(guess, timeZone);
  // Across a daylight-saving change the offset at the answer can differ from the offset at the guess.
  return guess - offsetAt(first, timeZone);
}

/** Today's calendar date in a time zone. */
function todayIn(timeZone: string, now: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

const overlaps = (aStart: number, aEnd: number, b: Interval) => aStart < Date.parse(b.end) && Date.parse(b.start) < aEnd;

/** Every open demo slot from our hours, minus anything that overlaps `busy`. */
export function openSlots(busy: Interval[], now = Date.now()): Interval[] {
  return openSlotsWhere((slot) => busy.some((b) => overlaps(Date.parse(slot.start), Date.parse(slot.end), b)), now);
}

/** Every demo slot from our hours that `taken` doesn't rule out: the per-person rule in team-availability.ts. */
export function openSlotsWhere(taken: (slot: Interval) => boolean, now = Date.now()): Interval[] {
  const { timeZone, hours, slotMinutes, minNoticeHours, daysAhead } = AVAILABILITY;
  const earliest = now + minNoticeHours * 3_600_000;
  const slotMs = slotMinutes * 60_000;
  const today = todayIn(timeZone, now);
  const slots: Interval[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    const day = new Date(Date.UTC(today.y, today.m, today.d + i));
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
    for (const window of hours[day.getUTCDay()] ?? []) {
      const end = zonedToUtc(y, m, d, window.end, timeZone);
      for (let start = zonedToUtc(y, m, d, window.start, timeZone); start + slotMs <= end; start += slotMs) {
        const slot = { start: new Date(start).toISOString(), end: new Date(start + slotMs).toISOString() };
        if (start < earliest || taken(slot)) continue;
        slots.push(slot);
      }
    }
  }
  return slots;
}

/** yyyy-mm-dd of an instant in a time zone, for grouping slots by the visitor's days. */
export function dateKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function formatInZone(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(new Date(iso));
}

/** "Tuesday, November 3, 2026 at 9:00 AM MST" */
export function describe(iso: string, timeZone: string) {
  return formatInZone(iso, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

import type { Interval } from "./slots";

/**
 * Who's on the team, and whether a demo time works for them. The rule: ophlow@gmail.com's own calendar holds the demos,
 * so a time it's busy is always taken. Otherwise a time is only taken when every team member is busy then; one free
 * person is enough to run the demo. Everything comes from GOOGLE_CALENDAR_IDS, GOOGLE_TEAM_ATTENDEES and live
 * free/busy; no one's address or availability is in code.
 */

export const ORGANIZER = "ophlow@gmail.com";
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[a-z]{2,}$/i;

export type TeamMember = {
  /** Their calendar, as Google free/busy knows it. */
  calendarId: string;
  /** First name for the team email ("Ash"), or the address's first part when no name is given. */
  name: string;
  /** Their invite address, when they're in GOOGLE_TEAM_ATTENDEES; null for a calendar that's only checked. */
  invite: string | null;
};

const isOrganizer = (id: string) => id === "primary" || id.toLowerCase() === ORGANIZER;

/**
 * Reads GOOGLE_TEAM_ATTENDEES ("Ash <a@x.com>" or just "a@x.com", comma-separated) and GOOGLE_CALENDAR_IDS. Every
 * calendar but ophlow's is a team member; an attendee with no calendar listed is checked by their own address.
 * `skipped` counts entries that aren't email addresses, so they can be flagged without printing them.
 */
export function teamFrom(attendeesRaw = process.env.GOOGLE_TEAM_ATTENDEES, calendarIdsRaw = process.env.GOOGLE_CALENDAR_IDS) {
  let skipped = 0;
  const people = new Map<string, TeamMember>();
  for (const entry of (attendeesRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(/^(.*?)\s*<([^>]+)>$/);
    const email = (m ? m[2] : entry).trim().toLowerCase();
    if (!EMAIL.test(email)) {
      skipped++;
      continue;
    }
    if (isOrganizer(email)) continue;
    const name = (m?.[1].trim() || email.split("@")[0]).slice(0, 40);
    people.set(email, { calendarId: email, name, invite: email });
  }
  for (const id of (calendarIdsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (isOrganizer(id) || people.has(id.toLowerCase())) continue;
    people.set(id.toLowerCase(), { calendarId: id, name: id.split("@")[0], invite: null });
  }
  return { members: [...people.values()], skipped };
}

/** Free/busy for ophlow and each team member, read separately. `busy: null` means that calendar couldn't be read. */
export type TeamFreeBusy = {
  organizer: Interval[] | null;
  members: { member: TeamMember; busy: Interval[] | null }[];
};

const overlaps = (start: number, end: number, b: Interval) => start < Date.parse(b.end) && Date.parse(b.start) < end;

export type SlotCheck = { blocked: boolean; free: TeamMember[]; busy: TeamMember[]; unknown: TeamMember[] };

/**
 * One time against the rule. Blocked when ophlow is busy; otherwise when every team member is busy. A calendar that
 * can't be read counts as neither busy nor free ("unknown"): it never blocks a time on its own, and with any unknown,
 * a time is only blocked when everyone who could be read is busy and at least two were read.
 */
export function checkSlot(fb: TeamFreeBusy, slot: Interval): SlotCheck {
  const [start, end] = [Date.parse(slot.start), Date.parse(slot.end)];
  const free: TeamMember[] = [];
  const busy: TeamMember[] = [];
  const unknown: TeamMember[] = [];
  for (const { member, busy: times } of fb.members) {
    if (times === null) unknown.push(member);
    else if (times.some((b) => overlaps(start, end, b))) busy.push(member);
    else free.push(member);
  }
  const organizerBusy = (fb.organizer ?? []).some((b) => overlaps(start, end, b));
  const read = free.length + busy.length;
  const everyoneBusy = fb.members.length > 0 && (unknown.length ? read >= 2 && free.length === 0 : free.length === 0);
  return { blocked: organizerBusy || everyoneBusy, free, busy, unknown };
}

/** How many calendars were read at all, ophlow's included. Zero means no times can be trusted. */
export const calendarsRead = (fb: TeamFreeBusy) => (fb.organizer ? 1 : 0) + fb.members.filter((m) => m.busy !== null).length;

/**
 * Who gets the invite and the team email for a time: the free, plus anyone whose calendar couldn't be read (they
 * aren't known to be busy, and leaving them out would mean someone who hasn't shared yet never hears about a demo).
 * Only people in GOOGLE_TEAM_ATTENDEES can be invited.
 */
export const invitees = (c: SlotCheck) => [...c.free, ...c.unknown].filter((m) => m.invite);

/** "Free: Ash, Ben Park. Busy: Ben Taylor." with first names only, for the team email. Nothing else from anyone's calendar. */
export function whoIsFree(c: SlotCheck) {
  const list = (people: TeamMember[]) => people.map((m) => m.name).join(", ") || "nobody";
  return [`Free: ${list(c.free)}.`, `Busy: ${list(c.busy)}.`, ...(c.unknown.length ? [`Couldn't check: ${list(c.unknown)}.`] : [])].join(" ");
}

const unique = (emails: string[]) => [...new Set(emails.map((e) => e.toLowerCase()))];

/** The event's guest list for a time: the visitor plus the team members `invitees` picks. */
export const eventAttendees = (visitor: string, c: SlotCheck) => unique([visitor, ...invitees(c).map((m) => m.invite!)]);

/**
 * Moving a call: the guest list at the new time, who that adds and drops (Google tells both, with sendUpdates=all),
 * and which team members get our "moved" email (only those on the call at the new time).
 */
export function planMove(current: string[], visitor: string, c: SlotCheck) {
  const before = unique(current);
  const attendees = eventAttendees(visitor, c);
  return {
    attendees,
    added: attendees.filter((e) => !before.includes(e)),
    removed: before.filter((e) => !attendees.includes(e)),
    notify: invitees(c),
  };
}

/** Cancelling: only the team members who are on the event (as Google has it now) get our cancellation email. */
export const cancelRecipients = (attendees: string[], members: TeamMember[]) => {
  const on = unique(attendees);
  return members.filter((m) => m.invite && on.includes(m.invite));
};

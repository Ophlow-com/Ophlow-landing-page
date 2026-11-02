const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);

/** A one-event calendar file that Gmail, Outlook and Apple Calendar all open. */
export function icsEvent(e: { uid: string; start: string; end: string; summary: string; description: string; organizer: string; attendee?: string; location?: string | null }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ophlow//Demo booking//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${escape(e.summary)}`,
    `DESCRIPTION:${escape(e.description)}`,
    ...(e.location ? [`LOCATION:${escape(e.location)}`] : []),
    `ORGANIZER:mailto:${e.organizer}`,
    ...(e.attendee ? [`ATTENDEE;RSVP=TRUE:mailto:${e.attendee}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** A Google Calendar "add event" link, for the visitor's own calendar. */
export function googleCalendarLink(e: { start: string; end: string; summary: string; details: string; location?: string }) {
  const params = new URLSearchParams({ action: "TEMPLATE", text: e.summary, dates: `${stamp(e.start)}/${stamp(e.end)}`, details: e.details, ...(e.location ? { location: e.location } : {}) });
  return `https://calendar.google.com/calendar/render?${params}`;
}

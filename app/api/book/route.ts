import { bookingRows, bookingSummary, validBooking, type Booking } from "@/lib/booking";
import { icsEvent } from "@/lib/ics";
import { NOTIFY_TO, rowsToHtml, rowsToText, sendEmail } from "@/lib/server/email";
import { calendarConnected, createDemoEvent, teamFreeBusy } from "@/lib/server/google-calendar";
import { LeadError, leadsConnected, saveBooking } from "@/lib/server/leads";
import { createDemoMeeting } from "@/lib/server/zoom";
import { SITE } from "@/lib/site";
import { describe, openSlotsWhere } from "@/lib/slots";
import { calendarsRead, checkSlot, eventAttendees, invitees, whoIsFree, type SlotCheck } from "@/lib/team-availability";

/**
 * Books a call: re-checks the slot is still open, saves it (the database refuses a slot that's already taken), makes
 * a Zoom meeting, puts it on our calendar (GOOGLE_CREATE_EVENTS=true) with the visitor and the team members free then
 * as guests, then emails those team members and the visitor. Each of those is optional and none can undo the booking. With no database connected it answers `fallback: true` and the page
 * opens a pre-filled email instead.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (Partial<Booking> & { website?: string }) | null;
  // A hidden field people never see: bots fill it in. Pretend it worked.
  if (body?.website) return Response.json({ ok: true, confirmed: false, joinUrl: null });
  if (!validBooking(body)) return Response.json({ error: "Fill in your name, email and community, and pick a time." }, { status: 400 });
  const b = body;

  // Who's free right now, person by person (lib/team-availability.ts). Null when the calendar isn't connected.
  let team: SlotCheck | null = null;
  if (calendarConnected()) {
    let fb: Awaited<ReturnType<typeof teamFreeBusy>>;
    try {
      fb = await teamFreeBusy(new Date().toISOString(), new Date(Date.parse(b.end) + 60_000).toISOString());
    } catch (error) {
      console.error("re-checking team calendars failed", error);
      return Response.json({ error: `Couldn't read the team's calendars: ${error instanceof Error ? error.message : String(error)}` }, { status: 503 });
    }
    if (calendarsRead(fb) === 0) {
      return Response.json({ error: `Couldn't read any of the team's calendars: ${fb.errors.join("; ")}` }, { status: 503 });
    }
    team = checkSlot(fb, b);
  }
  const blocked = team?.blocked ?? false;
  const open = openSlotsWhere(() => blocked);
  if (!open.some((s) => s.start === b.start && s.end === b.end)) {
    return Response.json({ error: "That time isn't available any more. Please pick another." }, { status: 409 });
  }
  const teamInvites = team ? invitees(team).map((m) => m.invite!) : [];
  if (!leadsConnected()) return Response.json({ ok: false, fallback: true });

  try {
    await saveBooking({
      start: b.start,
      end: b.end,
      timeZone: b.timeZone,
      name: b.name,
      email: b.email,
      phone: b.phone,
      organization: b.community,
      details: { role: b.role, buildings: b.buildings, current: b.current, features: b.features },
      notes: b.notes,
    });
  } catch (error) {
    if (error instanceof LeadError && error.message === "slot_taken") {
      return Response.json({ error: "Someone just booked that time. Please pick another.", taken: true }, { status: 409 });
    }
    console.error("saving the booking failed", error);
    return Response.json({ ok: false, fallback: true });
  }

  // It's booked; everything below is a bonus and can't undo it.
  let zoomUrl: string | null = null;
  try {
    zoomUrl = (await createDemoMeeting({ topic: `${SITE.name} call`, start: b.start, end: b.end }))?.joinUrl ?? null;
  } catch (error) {
    console.error("creating the Zoom meeting failed", error);
  }

  const rows: [string, string][] = zoomUrl ? [["Zoom", zoomUrl], ...bookingRows(b)] : bookingRows(b);
  let eventLink: string | null = null;
  let meetUrl: string | null = null;
  try {
    // The visitor is a guest, so Google sends them the invite: the event holds only our own words, never what was
    // typed into the form (anyone can enter anyone's email). The details go to the team by email below.
    const event = await createDemoEvent({
      start: b.start,
      end: b.end,
      summary: `${SITE.name} call`,
      description: `Booked on ${SITE.name}. Questions: ${SITE.email}`,
      joinUrl: zoomUrl,
      attendees: team ? eventAttendees(b.email, team) : [],
    });
    eventLink = event?.htmlLink ?? null;
    meetUrl = event?.hangoutLink ?? null;
  } catch (error) {
    console.error("creating the calendar event failed", error);
  }
  const joinUrl = zoomUrl ?? meetUrl;
  // With a Google event, everyone on it already has it on their calendar: a calendar file too would be a second copy.
  const invited = Boolean(eventLink && team);

  try {
    const title = `New call booked: ${b.community}`;
    const groups = [
      {
        rows: [
          ...(meetUrl ? ([["Meet", meetUrl]] as [string, string][]) : []),
          ...rows,
          ...(team ? ([["Team", whoIsFree(team)]] as [string, string][]) : []),
          ...(eventLink ? ([["Calendar", eventLink]] as [string, string][]) : []),
        ],
      },
    ];
    await sendEmail({
      // Only the team members free then; with no team set up (or nobody to invite), ophlow's own inbox as before.
      to: teamInvites.length ? teamInvites : NOTIFY_TO,
      replyTo: b.email,
      subject: title,
      html: rowsToHtml(title, groups),
      text: rowsToText(title, groups),
      attachments: invited
        ? []
        : [
            {
              filename: "call.ics",
              content: icsEvent({ uid: `${crypto.randomUUID()}@ophlow`, start: b.start, end: b.end, summary: bookingSummary(b), description: rowsToText("", groups).trim(), organizer: NOTIFY_TO, attendee: b.email, location: joinUrl }),
              contentType: "text/calendar",
            },
          ],
    });
  } catch (error) {
    console.error("emailing the booking failed", error);
  }

  // Only our own words go to the visitor's address, never what was typed into the form: anyone can enter anyone's email.
  let confirmed = false;
  try {
    const when = `${describe(b.start, b.timeZone)} (${b.timeZone.replace(/_/g, " ")})`;
    const title = `Your ${SITE.name} call is booked`;
    const groups = [{ rows: [["When", when], ["Join", joinUrl ?? "We'll email you the video link before the call."], ["Questions", `Just reply to this email, or write to ${SITE.email}.`]] as [string, string][] }];
    const mail = await sendEmail({
      to: b.email,
      replyTo: SITE.email,
      subject: title,
      html: rowsToHtml(title, groups),
      text: rowsToText(title, groups),
      attachments: invited
        ? []
        : [
            {
              filename: "call.ics",
              content: icsEvent({
                uid: `${crypto.randomUUID()}@ophlow`,
                start: b.start,
                end: b.end,
                summary: `${SITE.name} call`,
                description: joinUrl ? `Join: ${joinUrl}` : "We'll email you the video link before the call.",
                organizer: NOTIFY_TO,
                attendee: b.email,
                location: joinUrl,
              }),
              contentType: "text/calendar",
            },
          ],
    });
    confirmed = mail.sent;
  } catch (error) {
    console.error("emailing the visitor failed", error);
  }

  return Response.json({ ok: true, confirmed, joinUrl });
}

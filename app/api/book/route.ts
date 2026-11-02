import { bookingRows, bookingSummary, validBooking, type Booking } from "@/lib/booking";
import { icsEvent } from "@/lib/ics";
import { NOTIFY_TO, rowsToHtml, rowsToText, sendEmail } from "@/lib/server/email";
import { busyTimes, calendarConnected, createDemoEvent } from "@/lib/server/google-calendar";
import { LeadError, leadsConnected, saveBooking } from "@/lib/server/leads";
import { createDemoMeeting } from "@/lib/server/zoom";
import { SITE } from "@/lib/site";
import { describe, openSlots } from "@/lib/slots";

/**
 * Books a demo: re-checks the slot is still open, saves it (the database refuses a slot that's already taken), makes
 * a Zoom meeting, puts it on our calendar (GOOGLE_CREATE_EVENTS=true), then emails us and the visitor. Each of those
 * is optional and none can undo the booking. With no database connected it answers `fallback: true` and the page
 * opens a pre-filled email instead.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (Partial<Booking> & { website?: string }) | null;
  // A hidden field people never see: bots fill it in. Pretend it worked.
  if (body?.website) return Response.json({ ok: true, confirmed: false, joinUrl: null });
  if (!validBooking(body)) return Response.json({ error: "Fill in your name, email and community, and pick a time." }, { status: 400 });
  const b = body;

  let busy: Awaited<ReturnType<typeof busyTimes>> = [];
  if (calendarConnected()) {
    try {
      busy = await busyTimes(new Date().toISOString(), new Date(Date.parse(b.end) + 60_000).toISOString());
    } catch (error) {
      console.error("re-checking team calendars failed", error);
    }
  }
  if (!openSlots(busy).some((s) => s.start === b.start && s.end === b.end)) {
    return Response.json({ error: "That time isn't available any more. Please pick another." }, { status: 409 });
  }
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
    zoomUrl = (await createDemoMeeting({ topic: `${SITE.name} demo`, start: b.start, end: b.end }))?.joinUrl ?? null;
  } catch (error) {
    console.error("creating the Zoom meeting failed", error);
  }

  const rows: [string, string][] = zoomUrl ? [["Zoom", zoomUrl], ...bookingRows(b)] : bookingRows(b);
  let eventLink: string | null = null;
  let meetUrl: string | null = null;
  try {
    const event = await createDemoEvent({ start: b.start, end: b.end, summary: bookingSummary(b), description: rowsToText("", [{ rows }]).trim(), joinUrl: zoomUrl });
    eventLink = event?.htmlLink ?? null;
    meetUrl = event?.hangoutLink ?? null;
  } catch (error) {
    console.error("creating the calendar event failed", error);
  }
  const joinUrl = zoomUrl ?? meetUrl;

  try {
    const title = `New demo booked: ${b.community}`;
    const groups = [{ rows: [...(meetUrl ? ([["Meet", meetUrl]] as [string, string][]) : []), ...rows, ...(eventLink ? ([["Calendar", eventLink]] as [string, string][]) : [])] }];
    await sendEmail({
      to: NOTIFY_TO,
      replyTo: b.email,
      subject: title,
      html: rowsToHtml(title, groups),
      text: rowsToText(title, groups),
      attachments: [
        {
          filename: "demo.ics",
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
    const title = `Your ${SITE.name} demo is booked`;
    const groups = [{ rows: [["When", when], ["Join", joinUrl ?? "We'll email you the video link before the call."], ["Questions", `Just reply to this email, or write to ${SITE.email}.`]] as [string, string][] }];
    const mail = await sendEmail({
      to: b.email,
      replyTo: SITE.email,
      subject: title,
      html: rowsToHtml(title, groups),
      text: rowsToText(title, groups),
      attachments: [
        {
          filename: "demo.ics",
          content: icsEvent({
            uid: `${crypto.randomUUID()}@ophlow`,
            start: b.start,
            end: b.end,
            summary: `${SITE.name} demo`,
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

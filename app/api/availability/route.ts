import { calendarConnected, teamFreeBusy } from "@/lib/server/google-calendar";
import { leadsConnected, takenSlots } from "@/lib/server/leads";
import { AVAILABILITY } from "@/lib/site";
import { openSlots, openSlotsWhere, type Interval } from "@/lib/slots";
import { calendarsRead, checkSlot } from "@/lib/team-availability";

export const dynamic = "force-dynamic";

/**
 * Open demo slots: our hours (lib/site.ts) minus demos already booked, minus times ophlow's calendar is busy or every
 * team member is (lib/team-availability.ts). Only times leave the server. When the calendar is connected but no
 * calendar at all could be read, it offers nothing and says why.
 */
export async function GET() {
  const now = Date.now();
  const [from, to] = [new Date(now).toISOString(), new Date(now + (AVAILABILITY.daysAhead + 2) * 86_400_000).toISOString()];
  let booked: Awaited<ReturnType<typeof takenSlots>> = [];
  if (leadsConnected()) {
    try {
      booked = await takenSlots(from, to, AVAILABILITY.slotMinutes);
    } catch (error) {
      // Better to show our hours than no calendar at all; booking re-checks the slot anyway.
      console.error("reading booked demos failed", error);
    }
  }
  if (!calendarConnected()) return Response.json({ slots: openSlots(booked, now) });

  let fb: Awaited<ReturnType<typeof teamFreeBusy>>;
  try {
    fb = await teamFreeBusy(from, to);
  } catch (error) {
    console.error("reading team calendars failed", error);
    return Response.json({ slots: [], error: `Couldn't read the team's calendars: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (calendarsRead(fb) === 0) {
    return Response.json({ slots: [], error: `Couldn't read any of the team's calendars: ${fb.errors.join("; ")}` });
  }
  const isBooked = (slot: Interval) => booked.some((b) => Date.parse(slot.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(slot.end));
  return Response.json({ slots: openSlotsWhere((slot) => isBooked(slot) || checkSlot(fb, slot).blocked, now) });
}

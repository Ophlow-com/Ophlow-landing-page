import type { Interval } from "@/lib/slots";
import { teamFrom, type TeamFreeBusy } from "@/lib/team-availability";

/**
 * Google Calendar through OAuth as ophlow@gmail.com (a plain API key can't read private calendars). Teammates
 * share their calendars with that account; GOOGLE_CALENDAR_IDS lists them, GOOGLE_TEAM_ATTENDEES says who to invite.
 * See README for getting the token. Whether a time works, and who's invited, is lib/team-availability.ts.
 */
const env = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
});

export const calendarConnected = () => {
  const e = env();
  return Boolean(e.clientId && e.clientSecret && e.refreshToken);
};

async function accessToken() {
  const e = env();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e.clientId!,
      client_secret: e.clientSecret!,
      refresh_token: e.refreshToken!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * Busy blocks for ophlow and for each team member, kept apart so the rule can tell one person being busy from
 * everyone being busy. Only times come back, never event titles or details. A calendar Google can't read (not shared
 * yet, no permission) comes back as `busy: null`, logged by its position in the list and Google's reason only;
 * `errors` holds those same lines, so a page can say why when nothing could be read.
 */
export async function teamFreeBusy(timeMin: string, timeMax: string): Promise<TeamFreeBusy & { errors: string[] }> {
  const { members, skipped } = teamFrom();
  if (skipped) console.error(`GOOGLE_TEAM_ATTENDEES: left out ${skipped} entr${skipped === 1 ? "y" : "ies"} that aren't email addresses`);
  const token = await accessToken();
  const items = ["primary", ...members.map((m) => m.calendarId)];
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: items.map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`google freebusy ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { calendars: Record<string, { busy?: Interval[]; errors?: { reason?: string }[] }> };
  const errors: string[] = [];
  const read = (id: string, i: number) => {
    const c = data.calendars[id];
    if (!c || c.errors?.length) {
      const line = `team calendar ${i} couldn't be read: ${c?.errors?.map((e) => e.reason).join(", ") || "missing from Google's answer"}`;
      console.error(line);
      errors.push(line);
      return null;
    }
    return c.busy ?? [];
  };
  return { organizer: read("primary", 0), members: members.map((member, i) => ({ member, busy: read(member.calendarId, i + 1) })), errors };
}

/**
 * Puts the demo on ophlow@gmail.com's calendar, with the Zoom link or else a new Meet link, inviting `attendees` (the
 * visitor and the team members free then), so the same event, with the same link, is on each of their calendars. One
 * event, never a copy per person. Google emails the invites (sendUpdates=all).
 */
export async function createDemoEvent(event: { start: string; end: string; summary: string; description: string; joinUrl?: string | null; attendees: string[] }) {
  if (!calendarConnected() || process.env.GOOGLE_CREATE_EVENTS !== "true") return null;
  const token = await accessToken();
  const updates = event.attendees.length ? "sendUpdates=all" : "sendUpdates=none";
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&${updates}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start },
      end: { dateTime: event.end },
      ...(event.attendees.length ? { attendees: event.attendees.map((email) => ({ email })) } : {}),
      ...(event.joinUrl
        ? { location: event.joinUrl }
        : { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
    }),
  });
  if (!res.ok) throw new Error(`google insert ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string; htmlLink: string; hangoutLink?: string };
}

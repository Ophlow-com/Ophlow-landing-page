import type { Interval } from "@/lib/slots";

/**
 * Google Calendar through OAuth as ophlow@gmail.com (a plain API key can't read private calendars). Teammates
 * share their calendars with that account; GOOGLE_CALENDAR_IDS lists them. See README for getting the token.
 */
const env = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  calendars: (process.env.GOOGLE_CALENDAR_IDS || "primary").split(",").map((s) => s.trim()).filter(Boolean),
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

/** Busy blocks across every team calendar. Only times come back — never event titles or details. */
export async function busyTimes(timeMin: string, timeMax: string): Promise<Interval[]> {
  if (!calendarConnected()) return [];
  const token = await accessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: env().calendars.map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`google freebusy ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { calendars: Record<string, { busy?: Interval[] }> };
  return Object.values(data.calendars).flatMap((c) => c.busy ?? []);
}

/**
 * Puts the demo on ophlow@gmail.com's calendar, with the Zoom link or else a new Meet link. The visitor isn't added as
 * a guest: the details hold what they typed, and Google would email those to whatever address was entered.
 */
export async function createDemoEvent(event: { start: string; end: string; summary: string; description: string; joinUrl?: string | null }) {
  if (!calendarConnected() || process.env.GOOGLE_CREATE_EVENTS !== "true") return null;
  const token = await accessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start },
      end: { dateTime: event.end },
      ...(event.joinUrl
        ? { location: event.joinUrl }
        : { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
    }),
  });
  if (!res.ok) throw new Error(`google insert ${res.status}: ${await res.text()}`);
  return (await res.json()) as { htmlLink: string; hangoutLink?: string };
}

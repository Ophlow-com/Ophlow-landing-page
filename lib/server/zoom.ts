/**
 * Zoom through a Server-to-Server OAuth app on our own account, so no visitor ever signs in to anything.
 * See README for creating the app. Only the join link leaves here: the host's start link is never used.
 */
const env = () => ({
  accountId: process.env.ZOOM_ACCOUNT_ID,
  clientId: process.env.ZOOM_CLIENT_ID,
  clientSecret: process.env.ZOOM_CLIENT_SECRET,
  host: process.env.ZOOM_HOST_EMAIL,
});

export const zoomConnected = () => {
  const e = env();
  return Boolean(e.accountId && e.clientId && e.clientSecret && e.host);
};

async function accessToken() {
  const e = env();
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${e.clientId}:${e.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "account_credentials", account_id: e.accountId! }),
  });
  if (!res.ok) throw new Error(`zoom token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** A new meeting just for this demo, on the host's Zoom. Null when Zoom isn't set up. */
export async function createDemoMeeting(meeting: { topic: string; start: string; end: string }) {
  if (!zoomConnected()) return null;
  const token = await accessToken();
  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(env().host!)}/meetings`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      topic: meeting.topic,
      type: 2,
      start_time: meeting.start,
      duration: Math.round((Date.parse(meeting.end) - Date.parse(meeting.start)) / 60_000),
      timezone: "UTC",
      settings: { waiting_room: true, join_before_host: false },
    }),
  });
  if (!res.ok) throw new Error(`zoom meeting ${res.status}: ${await res.text()}`);
  return { joinUrl: ((await res.json()) as { join_url: string }).join_url };
}

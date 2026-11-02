# Ophlow website

The public site for Ophlow: who we are, what we build, and product one (Ophlow for Senior Living).

- `npm install` once, copy `.env.example` to `.env.local` and fill it in, then `npm run dev` and open http://localhost:3002
- Hosted on Vercel: the routes in `app/api` save demo bookings and setup forms to Supabase (`supabase/leads.sql`).
  With no keys set, the forms fall back to a pre-filled email.

The contact address lives in `lib/site.ts` and the page text lives in `app/page.tsx`.

## Booking: what happens when someone books a demo

The booking is saved first, then each of these runs if its keys are set. None of them can undo the booking.

- **Email (Resend):** on now. The team gets an alert and the visitor gets a confirmation with a calendar file. Same key for every site.
- **Zoom:** each demo gets its own meeting, and the join link goes in both emails and on the "You're booked" screen. Without it, the visitor is told the link will follow.
- **Google Calendar:** times the team is busy disappear from `/book`, and with `GOOGLE_CREATE_EVENTS=true` each demo lands on the calendar.

**Turning on Zoom**

1. [marketplace.zoom.us](https://marketplace.zoom.us) → **Develop → Build App → Server-to-Server OAuth**. Your Zoom role needs permission to build these; on a one-person account you have it, otherwise ask the account owner.
2. Under **Scopes** add `meeting:write:meeting:admin`, then **Activate** the app.
3. In Vercel set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` from the app's credentials page, and `ZOOM_HOST_EMAIL` to the Zoom login that should host the demos. Redeploy.

**Turning on Google Calendar**

1. [console.cloud.google.com](https://console.cloud.google.com) → new project → enable **Google Calendar API**.
2. **OAuth consent screen** → External → **publish it** (left in "Testing", the token stops working after 7 days).
3. **Credentials → OAuth client ID** → type Web → redirect URI `https://developers.google.com/oauthplayground`.
4. [OAuth Playground](https://developers.google.com/oauthplayground) → gear icon → use your own credentials → scope `https://www.googleapis.com/auth/calendar` → sign in as ophlow@gmail.com → exchange for tokens → copy the **refresh token**.
5. Each teammate shares their calendar with ophlow@gmail.com ("See only free/busy" is enough).
6. In Vercel set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_IDS` (ophlow@gmail.com plus teammates' emails) and `GOOGLE_CREATE_EVENTS=true`. Redeploy.

What's left to do is in [ROADMAP.md](ROADMAP.md).

The site names no customers and shows only room numbers in its drawings of the app.

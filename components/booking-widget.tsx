"use client";

import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, Loader2, Mail, Video, X } from "lucide-react";
import { track } from "@vercel/analytics";
import { useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { TimeZonePicker, useDetectedTimeZone } from "@/components/time-zone-picker";
import { useUrlFeatures } from "@/components/use-url-features";
import { CURRENT_TOOLS, ROLE_OPTIONS, bookingMailto, type Booking } from "@/lib/booking";
import { FEATURE_BY_ID } from "@/lib/features";
import { googleCalendarLink } from "@/lib/ics";
import { AVAILABILITY, SITE } from "@/lib/site";
import { dateKey, describe, formatInZone, openSlots, type Interval } from "@/lib/slots";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const input =
  "w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-forest-400 focus:ring-2 focus:ring-forest-100";

export function BookingWidget() {
  const detected = useDetectedTimeZone();
  // Our hours (lib/site.ts) minus demos already booked, from the server. If it can't be reached, just our hours. If it
  // can't read any team calendar, no times and its reason.
  const [slots, setSlots] = useState<Interval[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const loadSlots = () =>
    fetch("/api/availability", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { slots: Interval[]; error?: string }) => {
        setSlotsError(d.error ?? null);
        setSlots(d.slots);
      })
      .catch(() => setSlots(openSlots([])));
  useEffect(() => {
    void loadSlots();
  }, []);
  const [chosenZone, setZone] = useState<string | null>(null);
  const zone = chosenZone ?? detected ?? AVAILABILITY.timeZone;
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Interval | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", community: "", role: ROLE_OPTIONS[0], buildings: "1", current: CURRENT_TOOLS[0], notes: "" });
  const picked = useUrlFeatures();
  const [dropped, setDropped] = useState<string[]>([]);
  const features = picked.filter((id) => !dropped.includes(id));
  const [done, setDone] = useState<{ kind: "sent"; told: boolean; joinUrl: string | null } | { kind: "fallback"; mailto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");

  const byDay = useMemo(() => {
    const map = new Map<string, Interval[]>();
    for (const s of slots ?? []) {
      const k = dateKey(s.start, zone);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [slots, zone]);

  const firstDay = byDay.keys().next().value as string | undefined;
  const shownMonth = useMemo(
    () => month ?? (firstDay ? { y: Number(firstDay.slice(0, 4)), m: Number(firstDay.slice(5, 7)) - 1 } : null),
    [month, firstDay],
  );
  const selectedDay = day && byDay.has(day) ? day : null;

  const cells = useMemo(() => {
    if (!shownMonth) return [];
    const lead = new Date(Date.UTC(shownMonth.y, shownMonth.m, 1)).getUTCDay();
    const count = new Date(Date.UTC(shownMonth.y, shownMonth.m + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => `${shownMonth.y}-${String(shownMonth.m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
    ];
  }, [shownMonth]);

  const shiftMonth = (delta: number) => {
    if (!shownMonth) return;
    const d = new Date(Date.UTC(shownMonth.y, shownMonth.m + delta, 1));
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };

  const submit = async () => {
    if (!slot) return;
    const booking: Booking = { ...form, start: slot.start, end: slot.end, timeZone: zone, features: features.map((id) => FEATURE_BY_ID[id].name) };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...booking, website }) });
      const reply = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Someone else got that time: drop it from the calendar and send them back to pick again.
        setError(reply.error ?? "That time was just taken. Please pick another.");
        setSlot(null);
        void loadSlots();
        return;
      }
      if (!res.ok) throw new Error(reply.error);
      if (reply.ok) {
        track("Demo booked");
        return setDone({ kind: "sent", told: Boolean(reply.confirmed), joinUrl: reply.joinUrl ?? null });
      }
      throw new Error();
    } catch (problem) {
      if (problem instanceof Error && problem.message) return setError(problem.message);
      // Server or database unreachable: fall back to a pre-filled email so the booking isn't lost.
      const link = bookingMailto(booking);
      setDone({ kind: "fallback", mailto: link });
      window.location.assign(link);
    } finally {
      setBusy(false);
    }
  };

  if (done?.kind === "sent" && slot) {
    return (
      <div className="mx-auto max-w-xl animate-rise rounded-[2rem] border border-ink-200 bg-paper p-8 text-center shadow-xl shadow-forest-900/5 sm:p-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-100 text-forest-800">
          <CalendarCheck className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-3xl font-semibold text-forest-950">You&apos;re booked.</h2>
        <p className="mt-3 text-ink-700">{describe(slot.start, zone)}</p>
        <p className="mt-4 leading-relaxed text-ink-600">
          {done.joinUrl
            ? done.told
              ? `The link to join is on its way to ${form.email}, and it's here too.`
              : "Save this link. It's how you'll join the call."
            : done.told
              ? `The details are on their way to ${form.email}. We'll send the video link before the call.`
              : `We've got it and will email ${form.email} the video link before the call.`}
        </p>
        {done.joinUrl ? (
          <a href={done.joinUrl} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 rounded-full bg-forest-800 px-6 py-3.5 text-sm font-semibold text-cream hover:bg-forest-900">
            <Video className="h-4 w-4" /> Join link
          </a>
        ) : null}
        <a
          href={googleCalendarLink({
            start: slot.start,
            end: slot.end,
            summary: `${SITE.name} call`,
            details: `${AVAILABILITY.slotMinutes}-minute call with the ${SITE.name} team. Questions: ${SITE.email}`,
            location: done.joinUrl ?? undefined,
          })}
          target="_blank"
          rel="noreferrer"
          className={
            done.joinUrl
              ? "mt-4 block text-sm font-semibold text-rust-600 underline underline-offset-4"
              : "mt-6 inline-flex items-center gap-2 rounded-full bg-forest-800 px-6 py-3.5 text-sm font-semibold text-cream hover:bg-forest-900"
          }
        >
          <CalendarCheck className="h-4 w-4" /> Add to my Google Calendar
        </a>
        <div className="mt-5">
          <BackLink className="text-sm text-ink-600 hover:text-forest-800" />
        </div>
      </div>
    );
  }

  if (done?.kind === "fallback" && slot) {
    const mailto = done.mailto;
    return (
      <div className="mx-auto max-w-xl animate-rise rounded-[2rem] border border-ink-200 bg-paper p-8 text-center shadow-xl shadow-forest-900/5 sm:p-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-100 text-forest-800">
          <Mail className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-3xl font-semibold text-forest-950">One last step.</h2>
        <p className="mt-3 text-ink-700">{describe(slot.start, zone)}</p>
        <p className="mt-4 leading-relaxed text-ink-600">
          Send us the pre-filled email to lock in this time — we&apos;ll reply with the video link. If your email app didn&apos;t open, use the
          button below.
        </p>
        <a href={mailto} className="mt-6 inline-flex items-center gap-2 rounded-full bg-forest-800 px-6 py-3.5 text-sm font-semibold text-cream hover:bg-forest-900">
          <Mail className="h-4 w-4" /> Send booking email
        </a>
        <a
          href={googleCalendarLink({
            start: slot.start,
            end: slot.end,
            summary: `${SITE.name} call`,
            details: `${AVAILABILITY.slotMinutes}-minute call with the ${SITE.name} team. Questions: ${SITE.email}`,
          })}
          target="_blank"
          rel="noreferrer"
          className="mt-6 block text-sm font-semibold text-rust-600 underline underline-offset-4"
        >
          Add to my Google Calendar
        </a>
        <button type="button" onClick={() => setDone(null)} className="mt-4 text-sm font-semibold text-ink-500 hover:text-forest-800">
          Edit my details
        </button>
        <div className="mt-3">
          <BackLink className="text-sm text-ink-600 hover:text-forest-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[2rem] border border-ink-200 bg-paper shadow-xl shadow-forest-900/5">
      <div className="grid lg:grid-cols-[17rem_1fr]">
        <aside className="border-b border-ink-100 bg-forest-900 p-7 text-cream lg:border-b-0">
          <p className="text-sm font-semibold uppercase tracking-wider text-rust-200">{SITE.name} team</p>
          <h2 className="mt-3 text-2xl font-semibold">{SITE.name} call</h2>
          <p className="mt-2 text-sm text-forest-200">{AVAILABILITY.slotMinutes} minutes · video call</p>
          <ul className="mt-6 space-y-2.5 text-sm text-forest-100">
            <li>• The manager website and staff phone app, live</li>
            <li>• Rooms, cleans, meals &amp; repairs, live</li>
            <li>• What we&apos;d set up for your floor</li>
            <li>• Becoming a design partner</li>
          </ul>
          {features.length ? (
            <div className="mt-7">
              <p className="text-xs font-bold uppercase tracking-wider text-rust-200">Your picks</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {features.map((id) => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-full bg-forest-800 py-1 pl-2.5 pr-1 text-xs font-semibold text-cream">
                    {FEATURE_BY_ID[id].name}
                    <button
                      type="button"
                      aria-label={`Remove ${FEATURE_BY_ID[id].name}`}
                      onClick={() => setDropped([...dropped, id])}
                      className="rounded-full p-0.5 text-forest-300 hover:bg-forest-700 hover:text-cream"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {slot ? (
            <div className="mt-7 rounded-2xl bg-forest-950/60 p-4 text-sm">
              <p className="font-semibold text-white">{formatInZone(slot.start, zone, { weekday: "long", month: "long", day: "numeric" })}</p>
              <p className="text-forest-200">
                {formatInZone(slot.start, zone, { hour: "numeric", minute: "2-digit" })} –{" "}
                {formatInZone(slot.end, zone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
              </p>
            </div>
          ) : null}
        </aside>

        {!slot ? (
          <div className="p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <p className="font-serif text-xl font-semibold text-forest-950">Pick a day and time</p>
              <TimeZonePicker value={zone} onChange={setZone} detected={detected} className="w-full sm:w-80" />
            </div>
            {error ? <p className="mb-5 rounded-2xl bg-rust-50 p-4 text-sm font-semibold text-rust-700">{error}</p> : null}

            {!slots ? (
              <p className="flex items-center gap-2 py-16 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading open times…
              </p>
            ) : slots.length === 0 && slotsError ? (
              <p className="rounded-2xl bg-rust-50 p-5 text-sm text-rust-700">
                <span className="font-semibold">We can&apos;t show open times right now.</span> {slotsError.replace(/\.?$/, ".")} Email{" "}
                <a className="font-semibold underline" href={`mailto:${SITE.email}?subject=Book%20a%20call`}>
                  {SITE.email}
                </a>{" "}
                and we&apos;ll find a time.
              </p>
            ) : slots.length === 0 ? (
              <p className="rounded-2xl bg-cream p-5 text-sm text-ink-700">
                We&apos;re fully booked for the next few weeks. Email{" "}
                <a className="font-semibold underline" href={`mailto:${SITE.email}?subject=Book%20a%20call`}>
                  {SITE.email}
                </a>{" "}
                and we&apos;ll make room.
              </p>
            ) : (
              <div className="grid gap-8 md:grid-cols-[1fr_13rem]">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="rounded-full p-2 text-ink-600 hover:bg-cream">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <p className="font-semibold text-forest-900">
                      {shownMonth ? new Date(Date.UTC(shownMonth.y, shownMonth.m, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : ""}
                    </p>
                    <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="rounded-full p-2 text-ink-600 hover:bg-cream">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {WEEK.map((w) => (
                      <span key={w} className="pb-2 text-xs font-semibold text-ink-400">
                        {w}
                      </span>
                    ))}
                    {cells.map((c, i) =>
                      c === null ? (
                        <span key={`blank-${i}`} />
                      ) : byDay.has(c) ? (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setDay(c)}
                          aria-pressed={selectedDay === c}
                          className={`aspect-square rounded-full text-sm font-semibold transition ${
                            selectedDay === c ? "bg-forest-800 text-cream shadow-md" : "bg-forest-50 text-forest-800 hover:bg-forest-100"
                          }`}
                        >
                          {Number(c.slice(8))}
                        </button>
                      ) : (
                        <span key={c} className="flex aspect-square items-center justify-center text-sm text-ink-300">
                          {Number(c.slice(8))}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-sm font-semibold text-ink-700">
                    {selectedDay
                      ? new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
                      : "Choose a highlighted day"}
                  </p>
                  <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                    {(selectedDay ? byDay.get(selectedDay)! : []).map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => {
                          setSlot(s);
                          track("Demo time picked");
                          setError(null);
                        }}
                        className="rounded-xl border border-forest-200 px-4 py-2.5 text-sm font-semibold text-forest-800 transition hover:border-forest-500 hover:bg-forest-50"
                      >
                        {formatInZone(s.start, zone, { hour: "numeric", minute: "2-digit" })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form
            className="p-6 sm:p-8"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <button type="button" onClick={() => setSlot(null)} className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-forest-800">
              <ArrowLeft className="h-4 w-4" /> Change time
            </button>
            <p className="font-serif text-xl font-semibold text-forest-950">Tell us about your place</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Your name *">
                <input required className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label="Email *">
                <input required type="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label="Where is your place? *">
                <input required className={input} value={form.community} onChange={(e) => setForm({ ...form, community: e.target.value })} autoComplete="organization" />
              </Field>
              <Field label="Phone">
                <input type="tel" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
              </Field>
              <Field label="You are">
                <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <Field label="How many places?">
                <select className={input} value={form.buildings} onChange={(e) => setForm({ ...form, buildings: e.target.value })}>
                  {["1", "2–3", "4–10", "10+"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <Field label="Who cleans it today?" wide>
                <select className={input} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}>
                  {CURRENT_TOOLS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <Field label="Anything you'd like us to focus on?" wide>
                <textarea
                  rows={3}
                  className={input}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. a 6-bedroom cabin in Island Park, busy May to September, my cleaner keeps cancelling…"
                />
              </Field>
            </div>
            {/* Hidden from people; bots that fill every field get politely ignored. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
            {error ? <p className="mt-4 text-sm font-semibold text-rust-600">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest-800 px-6 py-3.5 text-sm font-semibold text-cream transition hover:bg-forest-900 disabled:opacity-60 sm:w-auto"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              {busy ? "Booking…" : "Confirm demo"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-semibold text-ink-700">{label}</span>
      {children}
    </label>
  );
}

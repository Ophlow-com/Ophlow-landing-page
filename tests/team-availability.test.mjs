import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarsRead, cancelRecipients, checkSlot, eventAttendees, invitees, planMove, teamFrom, whoIsFree } from "../lib/team-availability.ts";

// Made-up team: three people, each with a calendar and an invite address.
const { members } = teamFrom("Ash <ash@example.com>,Ben Park <park@example.com>,Ben Taylor <taylor@example.com>", "ophlow@gmail.com,ash@example.com,park@example.com,taylor@example.com");
const [ash, park, taylor] = members;
const slot = { start: "2026-11-12T16:00:00.000Z", end: "2026-11-12T16:15:00.000Z" };
const during = [{ start: "2026-11-12T15:30:00.000Z", end: "2026-11-12T17:00:00.000Z" }];
const fb = (busy, organizer = []) => ({ organizer, members: [ash, park, taylor].map((m) => ({ member: m, busy: busy[m.name] === undefined ? [] : busy[m.name] })) });

test("reads names, addresses and calendars, and leaves ophlow out of the team", () => {
  assert.deepEqual(members.map((m) => [m.name, m.invite, m.calendarId]), [
    ["Ash", "ash@example.com", "ash@example.com"],
    ["Ben Park", "park@example.com", "park@example.com"],
    ["Ben Taylor", "taylor@example.com", "taylor@example.com"],
  ]);
  const t = teamFrom("ophlow@gmail.com,not an email,solo@example.com", "primary,checked-only@example.com");
  assert.deepEqual(t.members.map((m) => [m.name, m.invite]), [["solo", "solo@example.com"], ["checked-only", null]]);
  assert.equal(t.skipped, 1);
});

test("all three busy: the time isn't offered", () => {
  assert.equal(checkSlot(fb({ Ash: during, "Ben Park": during, "Ben Taylor": during }), slot).blocked, true);
});

test("two busy, one free: offered, and only the free one is invited", () => {
  const c = checkSlot(fb({ Ash: during, "Ben Park": during }), slot);
  assert.equal(c.blocked, false);
  assert.deepEqual(invitees(c).map((m) => m.name), ["Ben Taylor"]);
  assert.equal(whoIsFree(c), "Free: Ben Taylor. Busy: Ash, Ben Park.");
});

test("one busy, two free: offered, the two free invited", () => {
  const c = checkSlot(fb({ Ash: during }), slot);
  assert.equal(c.blocked, false);
  assert.deepEqual(invitees(c).map((m) => m.name), ["Ben Park", "Ben Taylor"]);
});

test("all free: offered, everyone invited", () => {
  const c = checkSlot(fb({}), slot);
  assert.equal(c.blocked, false);
  assert.equal(invitees(c).length, 3);
});

test("ophlow busy (a demo's already there): never offered, even with everyone free", () => {
  assert.equal(checkSlot(fb({}, during), slot).blocked, true);
});

test("a calendar that can't be read never blocks a time on its own", () => {
  // Ben Taylor unreadable, the other two busy: blocked (two read, both busy).
  assert.equal(checkSlot(fb({ Ash: during, "Ben Park": during, "Ben Taylor": null }), slot).blocked, true);
  // Two unreadable, Ash busy: only one read, so it isn't enough to block.
  const c = checkSlot(fb({ Ash: during, "Ben Park": null, "Ben Taylor": null }), slot);
  assert.equal(c.blocked, false);
  assert.deepEqual(c.unknown.map((m) => m.name), ["Ben Park", "Ben Taylor"]);
  assert.match(whoIsFree(c), /Couldn't check: Ben Park, Ben Taylor\./);
});

test("counts how many calendars were read, so zero can be refused", () => {
  assert.equal(calendarsRead({ organizer: null, members: [{ member: ash, busy: null }] }), 0);
  assert.equal(calendarsRead(fb({ "Ben Park": null })), 3);
});

test("only Ash set up so far: Ash busy still blocks, as it does today", () => {
  const solo = teamFrom("", "ophlow@gmail.com,ash@example.com").members;
  assert.equal(checkSlot({ organizer: [], members: [{ member: solo[0], busy: during }] }, slot).blocked, true);
});

test("a busy block that only touches the slot's edge doesn't make anyone busy", () => {
  const before = [{ start: "2026-11-12T15:45:00.000Z", end: "2026-11-12T16:00:00.000Z" }];
  const after = [{ start: "2026-11-12T16:15:00.000Z", end: "2026-11-12T16:30:00.000Z" }];
  assert.equal(checkSlot(fb({ Ash: before, "Ben Park": after, "Ben Taylor": before }), slot).blocked, false);
});

test("booking: the event's guests are the visitor plus only the free members", () => {
  const c = checkSlot(fb({ "Ben Taylor": during }), slot);
  assert.deepEqual(eventAttendees("Visitor@Example.com", c), ["visitor@example.com", "ash@example.com", "park@example.com"]);
  assert.equal(whoIsFree(c), "Free: Ash, Ben Park. Busy: Ben Taylor.");
  // A visitor who is also on the team isn't listed twice.
  assert.deepEqual(eventAttendees("ash@example.com", c), ["ash@example.com", "park@example.com"]);
});

test("booking: a calendar that's only checked (not in GOOGLE_TEAM_ATTENDEES) is never invited", () => {
  const t = teamFrom("Ash <ash@example.com>", "ophlow@gmail.com,ash@example.com,watch@example.com").members;
  const c = checkSlot({ organizer: [], members: t.map((m) => ({ member: m, busy: [] })) }, slot);
  assert.deepEqual(eventAttendees("v@example.com", c), ["v@example.com", "ash@example.com"]);
});

test("move: adds whoever is newly free, removes whoever is now busy, emails only those free at the new time", () => {
  const current = ["v@example.com", "ash@example.com", "park@example.com"];
  const c = checkSlot(fb({ Ash: during }), slot);
  const plan = planMove(current, "v@example.com", c);
  assert.deepEqual(plan.attendees, ["v@example.com", "park@example.com", "taylor@example.com"]);
  assert.deepEqual(plan.added, ["taylor@example.com"]);
  assert.deepEqual(plan.removed, ["ash@example.com"]);
  assert.deepEqual(plan.notify.map((m) => m.name), ["Ben Park", "Ben Taylor"]);
});

test("move: same people free at the new time means no adds or removals", () => {
  const plan = planMove(["V@example.com", "ash@example.com"], "v@example.com", checkSlot(fb({ "Ben Park": during, "Ben Taylor": during }), slot));
  assert.deepEqual([plan.added, plan.removed], [[], []]);
});

test("cancel: only team members who are on the event get the email", () => {
  assert.deepEqual(cancelRecipients(["v@example.com", "PARK@example.com", "someone@else.com"], members).map((m) => m.name), ["Ben Park"]);
  assert.deepEqual(cancelRecipients([], members), []);
});

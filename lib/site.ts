export const SITE = {
  name: "Ophlow",
  tagline: "Cabin Care: your cabin, handled.",
  description:
    "Ophlow Cabin Care runs your Island Park cabin day to day: guest messages, cleaning between guests, photo checks and repairs. You keep your listing and your prices. It costs 10% of your payout.",
  email: "ophlow@gmail.com",
};

export const NAV = [
  { href: "/#how", label: "What we handle" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#start", label: "Getting started" },
  { href: "/#faq", label: "FAQ" },
  // Hidden while the blog posts are about senior living: { href: "/blog", label: "Blog" },
];

/**
 * When we take demos. Times are wall-clock in the team's time zone; the booking page shows them in the
 * visitor's. The site is static, so there's no calendar check: the booking email is how a slot gets confirmed.
 */
export const AVAILABILITY = {
  timeZone: "America/Denver",
  /** 0 = Sunday. Several windows a day are fine. */
  hours: {
    1: [{ start: "09:00", end: "17:00" }],
    2: [{ start: "09:00", end: "17:00" }],
    3: [{ start: "09:00", end: "17:00" }],
    4: [{ start: "09:00", end: "17:00" }],
    5: [{ start: "09:00", end: "17:00" }],
  } as Record<number, { start: string; end: string }[]>,
  slotMinutes: 15,
  /** No booking sooner than this from now. */
  minNoticeHours: 12,
  daysAhead: 21,
};

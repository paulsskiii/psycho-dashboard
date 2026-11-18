// Pages behind "More" on phones; listed in full on the desktop rail. Plain module so server
// pages (/more) and the client Nav can both import it.

export const SECONDARY = [
  { href: "/intensity", label: "Intensity", blurb: "Easy vs hard time each week, and the 80/20 check" },
  { href: "/efficiency", label: "Efficiency", blurb: "Efficiency factor, heat, decoupling, pace at fixed heart rate" },
  { href: "/races", label: "Races", blurb: "Countdown, goal gap, predictions and personal bests" },
  { href: "/body", label: "Body", blurb: "Weight against your target" },
  { href: "/sports", label: "Sports", blurb: "Rides and strength sessions" },
  { href: "/settings", label: "Settings", blurb: "Sync health, heart-rate numbers, goals and your week" },
] as const;

import { expect, test } from "@playwright/test";

// Signed-in pages: layout guards + screenshots for the self-critique (spec §0.5, Phase 4).
const PAGES = [
  { path: "/", name: "today" },
  { path: "/form", name: "form" },
  { path: "/recovery", name: "recovery" },
  { path: "/runs", name: "runs" },
  { path: "/intensity", name: "intensity" },
  { path: "/efficiency", name: "efficiency" },
  { path: "/races", name: "races" },
  { path: "/body", name: "body" },
  { path: "/sports", name: "sports" },
  { path: "/sports?tab=ride", name: "sports-ride" },
  { path: "/settings", name: "settings" },
  { path: "/more", name: "more" },
  { path: "/activity/25086182199", name: "activity-run" },
  { path: "/activity/25095407714", name: "activity-strength" },
];

for (const p of PAGES) {
  test(`${p.name} renders without overflow`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(p.path);
    await expect(page).not.toHaveURL(/signin/);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal page scroll").toBeLessThanOrEqual(0);
    await page.screenshot({ path: `screenshots/${p.name}-${info.project.name}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });
}

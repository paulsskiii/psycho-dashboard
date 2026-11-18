import { expect, test } from "@playwright/test";

// Screenshots for the self-critique (spec §0.5) plus layout guards: no horizontal overflow and
// no chart wider than its container.
test("lab renders without overflow", async ({ page }, info) => {
  await page.goto("/lab");
  await page.waitForSelector("svg[role=img]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal page scroll").toBeLessThanOrEqual(0);

  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("svg")]
      .filter((svg) => {
        const p = svg.parentElement?.getBoundingClientRect();
        const r = svg.getBoundingClientRect();
        return p && r.width > p.width + 1;
      })
      .map((svg) => svg.getAttribute("aria-label")),
  );
  expect(clipped, "charts wider than their container").toEqual([]);

  await page.screenshot({ path: `screenshots/lab-${info.project.name}.png`, fullPage: true });
  await page.screenshot({ path: `screenshots/lab-${info.project.name}-fold.png` });
});

// Regression: charts drawn at desktop width must shrink when the window narrows (Brave device
// mode / phone rotation). Previously the SVG's pixel width propped its container open.
test("charts shrink when the window narrows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab");
  await page.waitForSelector("svg[role=img]");
  await page.setViewportSize({ width: 343, height: 740 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal page scroll after narrowing").toBeLessThanOrEqual(0);
  const tooWide = await page.evaluate(() =>
    [...document.querySelectorAll("svg")].filter((svg) => {
      const section = svg.closest("section")?.getBoundingClientRect();
      return section && svg.getBoundingClientRect().right > section.right + 1;
    }).length,
  );
  expect(tooWide, "charts sticking out of their section").toBe(0);
});

test("crosshair tooltip and table toggle work", async ({ page }) => {
  await page.goto("/lab");
  const chart = page.getByRole("img", { name: /Fitness and fatigue/ });
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("status").first()).toContainText("Fitness");
  await page.getByRole("button", { name: "Table" }).first().click();
  await expect(page.getByRole("table").first()).toBeVisible();
});

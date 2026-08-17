import { expect, test } from "@playwright/test";

test("娱乐页不展示 Wallpaper Engine", async ({ page }) => {
  await page.route("**/api/steam/overview", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      profile: { steamId: "76561198000000000", name: "NextAlex Steam", profileUrl: "https://steamcommunity.com/id/nextalex", avatarUrl: "", personaState: 1 },
      gameCount: 2,
      totalPlaytime: 300,
      recentlyPlayed: [{ appId: 431960, name: "Wallpaper Engine", playtimeForever: 200, playtime2Weeks: 10 }],
      games: [{ appId: 431960, name: "Wallpaper Engine", playtimeForever: 200, playtime2Weeks: 10 }, { appId: 10, name: "Counter-Strike", playtimeForever: 100, playtime2Weeks: 0 }],
    }) });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "娱乐", exact: true }).click();

  const steamPage = page.locator(".steam-page");
  await expect(steamPage.locator('[aria-label*="Wallpaper Engine"]')).toHaveCount(0);
  await expect(steamPage.locator('.steam-library-accordion-item[aria-label*="Counter-Strike"]')).toBeVisible();
});

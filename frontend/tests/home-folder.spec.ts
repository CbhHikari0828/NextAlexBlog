import { expect, test } from "@playwright/test";

test("首页快捷文件夹默认突出笔记，悬停文章卡覆盖并可跳转", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");

  const folder = page.locator(".home-folder-widget");
  await folder.scrollIntoViewIfNeeded();
  await folder.locator(".folder-trigger").click();

  const primaryFile = folder.locator(".file-1");
  const articleFile = folder.locator(".file-2");
  await expect(primaryFile).toHaveCSS("z-index", "100");
  await articleFile.hover();
  await expect(articleFile).toHaveCSS("z-index", "130");

  const articleIsOnTop = await page.evaluate(() => {
    const primary = document.querySelector<HTMLElement>(".home-folder-widget .file-1");
    const article = document.querySelector<HTMLElement>(".home-folder-widget .file-2");
    if (!primary || !article) return false;

    const primaryBox = primary.getBoundingClientRect();
    const articleBox = article.getBoundingClientRect();
    const left = Math.max(primaryBox.left, articleBox.left);
    const right = Math.min(primaryBox.right, articleBox.right);
    const top = Math.max(primaryBox.top, articleBox.top);
    const bottom = Math.min(primaryBox.bottom, articleBox.bottom);
    if (left >= right || top >= bottom) return false;

    const topElement = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return topElement === article || article.contains(topElement);
  });
  expect(articleIsOnTop).toBe(true);

  await articleFile.click();
  await expect(page.locator(".article-index")).toBeVisible();
});

test("首页快捷文件夹在手机宽度下不产生横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const folder = page.locator(".home-folder-widget");
  await folder.locator(".folder-trigger").click();
  const collapseButton = folder.getByRole("button", { name: "收起文件" });
  await expect(collapseButton).toBeVisible();
  await collapseButton.click();
  await expect(folder.locator(".folder-toggle")).not.toBeChecked();
  await folder.locator(".folder-trigger").click();

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

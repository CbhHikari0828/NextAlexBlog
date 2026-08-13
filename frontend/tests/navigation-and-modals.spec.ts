import { expect, test } from "@playwright/test";

test.describe("页面切换和弹窗交互", () => {
  test("快速连续导航最终停留在最后选择的页面", async ({ page }) => {
    await page.goto("/");

    const navigation = page.locator(".main-nav");
    await navigation.getByRole("button", { name: "文章" }).click();
    await navigation.getByRole("button", { name: "留言板" }).click();
    await navigation.getByRole("button", { name: "创作图库" }).click();

    await expect(page.locator(".gallery-grid")).toBeVisible();
    await expect(navigation.getByRole("button", { name: "创作图库" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".article-index")).toHaveCount(0);
    await expect(page.locator(".guestbook-wall")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-page-transition");
  });

  test("首页底部保留黑色版本信息区", async ({ page }) => {
    await page.goto("/");
    await page.locator(".site-footer").scrollIntoViewIfNeeded();

    const footer = page.locator(".site-footer");
    await expect(footer).toBeInViewport();
    await expect(footer).toHaveCSS("background-color", "rgb(16, 22, 25)");
  });

  test("创作图库使用全宽作品画布与黑色底部", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto("/");
    await page.locator(".main-nav").getByRole("button", { name: "创作图库", exact: true }).click();

    const showcase = page.locator(".gallery-showcase");
    const footer = page.locator(".site-footer");
    await expect(showcase).toBeVisible();
    await expect(footer).toHaveCSS("background-color", "rgb(16, 22, 25)");

    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const showcaseWidth = await showcase.evaluate((element) => element.getBoundingClientRect().width);
    const footerWidth = await footer.evaluate((element) => element.getBoundingClientRect().width);
    expect(showcaseWidth).toBeGreaterThan(viewportWidth * 0.85);
    expect(footerWidth).toBe(viewportWidth);
  });

  test("笔记页使用最近更新列表与关于本站信息卡", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/");
    await page.locator(".main-nav").getByRole("button", { name: "笔记", exact: true }).click();

    const notesLayout = page.locator(".notes-layout");
    const footer = page.locator(".site-footer");
    await expect(notesLayout).toBeVisible();
    await expect(notesLayout.getByRole("heading", { name: "最近更新" })).toBeVisible();
    await expect(page.locator(".notes-about-card")).toBeVisible();
    await expect(footer).toHaveCSS("background-color", "rgb(255, 255, 255)");

    const pageWidth = await page.evaluate(() => window.innerWidth);
    const footerWidth = await footer.evaluate((element) => element.getBoundingClientRect().width);
    expect(footerWidth).toBe(pageWidth);

    await expect(page.locator(".notes-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const footerBottom = await footer.evaluate((element) => Math.round(element.getBoundingClientRect().bottom));
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(footerBottom).toBe(viewportHeight);
  });

  test("笔记在当前页面通过小弹窗展示完整内容", async ({ page }) => {
    await page.goto("/");
    await page.locator(".main-nav").getByRole("button", { name: "笔记", exact: true }).click();

    const noteTrigger = page.locator(".note-entry").first();
    await noteTrigger.click();

    const dialog = page.locator(".note-dialog");
    const closeButton = dialog.getByRole("button", { name: "关闭" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "并发学习方法" })).toBeVisible();
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(noteTrigger).toBeFocused();
  });

  test("文章列表每页展示五篇并支持分页和分类重置", async ({ page }) => {
    await page.goto("/");
    await page.locator(".main-nav").getByRole("button", { name: "文章", exact: true }).click();

    const articleList = page.locator(".article-list");
    const pagination = page.locator(".article-pagination");
    await expect(articleList.locator(".article-feed-item")).toHaveCount(5);
    await expect(pagination.getByRole("button", { name: "上一页" })).toBeDisabled();
    await expect(pagination.getByRole("button", { name: "下一页" })).toBeEnabled();

    await pagination.getByRole("button", { name: "2", exact: true }).click();
    await expect(pagination.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(pagination.getByRole("button", { name: "上一页" })).toBeEnabled();
    await expect(pagination.getByRole("button", { name: "下一页" })).toBeDisabled();

    await page.getByRole("tab", { name: "JUC 基础" }).click();
    await expect(pagination.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(articleList.locator(".article-feed-item")).toHaveCount(4);
  });

  test("文章阅读器循环焦点并在 Escape 后还原触发按钮", async ({ page }) => {
    await page.goto("/");

    const articleTrigger = page.locator(".recent-article").first();
    await articleTrigger.click();

    const reader = page.locator(".article-reader");
    const backButton = page.locator(".article-reader-back");
    const outlineToggle = page.locator(".article-outline-toggle");
    await expect(reader).toBeVisible();
    await expect(backButton).toBeFocused();
    await expect(outlineToggle).toBeVisible();
    await expect(reader.locator("pre code.hljs").first()).toBeVisible();
    await expect(reader.locator("pre code .hljs-keyword").first()).toBeVisible();

    await page.keyboard.press("Shift+Tab");
    await expect(outlineToggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(backButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(articleTrigger).toBeFocused();
  });

  test("创作弹窗将 Tab 留在弹窗内并在 Escape 后还原触发按钮", async ({ page }) => {
    await page.goto("/");

    const creationTrigger = page.locator(".creation-card").first();
    await creationTrigger.click();

    const backdrop = page.locator(".drawer-backdrop");
    const closeButton = page.locator(".close-button");
    await expect(backdrop).toBeVisible();
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(backdrop).toHaveCount(0);
    await expect(creationTrigger).toBeFocused();
  });
});

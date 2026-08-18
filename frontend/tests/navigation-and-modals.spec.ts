import { expect, test } from "@playwright/test";

test.describe("页面切换和弹窗交互", () => {
  test("管理员端按需打开文章编辑器并支持 Markdown 预览", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.locator(".admin-article-editor")).toHaveCount(0);
    await page.locator(".admin-module-card").filter({ hasText: "文章发布" }).click();

    const editor = page.locator(".admin-article-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel("标题").fill("Markdown 发布测试");
    await editor.getByLabel("正文 Markdown").fill("# Markdown 发布测试\n\n```java\nvar value = 1;\n```");
    await editor.getByRole("tab", { name: "预览" }).click();
    await expect(editor.locator(".admin-markdown-preview h1")).toHaveText("Markdown 发布测试");
    await expect(editor.locator("pre code.hljs")).toBeVisible();

    await editor.getByRole("tab", { name: "撰写" }).click();
    await editor.getByRole("button", { name: "保存草稿" }).click();
    await expect(editor.locator(".admin-editor-footer > span")).toHaveText("已保存");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nextalex-admin-article-draft"))).toContain("Markdown 发布测试");
  });

  test("管理员端保留的发布入口均可保存内容", async ({ page }) => {
    await page.goto("/admin");

    const navigation = page.locator(".admin-nav");

    await navigation.getByRole("button", { name: "笔记发布" }).click();
    const noteEditor = page.locator(".admin-article-editor");
    await noteEditor.getByLabel("标题").fill("并发学习记录");
    await noteEditor.getByLabel("正文 Markdown").fill("# 笔记");
    await noteEditor.getByRole("button", { name: "保存草稿" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nextalex-admin-note-draft"))).toContain("并发学习记录");

    await navigation.getByRole("button", { name: "图库发布" }).click();
    const galleryEditor = page.locator(".admin-form-editor");
    await galleryEditor.getByLabel("标题").fill("抽象几何");
    await galleryEditor.getByLabel("本地图片").setInputFiles({
      name: "abstract.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlqP8QAAAAASUVORK5CYII=", "base64"),
    });
    await expect(galleryEditor.locator(".admin-image-preview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await galleryEditor.getByLabel("模型").fill("Flux");
    await galleryEditor.getByLabel("提示词").fill("abstract geometry");
    await galleryEditor.getByRole("button", { name: "发布" }).click();
    await expect(galleryEditor.locator(".admin-editor-footer > span")).toHaveText("已发布");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nextalex-admin-published-gallery"))).toContain("抽象几何");

    await page.goto("/");
    await page.locator(".main-nav").getByRole("tab", { name: "创作图库", exact: true }).click();
    await expect(page.locator(".gallery-card").filter({ hasText: "抽象几何" })).toBeVisible();
    await expect(page.locator(".gallery-card").filter({ hasText: "抽象几何" }).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);

    await page.goto("/admin");
    let syncRequestCount = 0;
    await page.route("**/api/admin/github/refresh", async (route) => {
      expect(route.request().method()).toBe("POST");
      syncRequestCount += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile: { username: "CbhHikari0828", repositoryCount: 1, stars: 0, forks: 0, followers: 0 }, repositories: [{ name: "NextAlexBlog", description: "个人技术与创作平台", htmlUrl: "https://github.com/CbhHikari0828/NextAlexBlog", language: "TypeScript", updatedAt: "2026-08-17T00:00:00Z" }], contributions: { username: "CbhHikari0828", year: 2026, total: 0, days: [] }, refreshedAt: "2026-08-17T12:00:00Z" }) });
    });
    await page.locator(".admin-nav").getByRole("button", { name: "项目同步" }).click();
    await page.getByRole("button", { name: "同步项目" }).click();
    await expect(page.locator(".admin-project-list").getByRole("link", { name: /NextAlexBlog/ })).toBeVisible();
    expect(syncRequestCount).toBe(1);

    let steamRefreshCount = 0;
    await page.route("**/api/admin/steam/refresh", async (route) => {
      expect(route.request().method()).toBe("POST");
      steamRefreshCount += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ gameCount: 24, games: [{ appId: 10 }], recentlyPlayed: [{ appId: 10 }, { appId: 20 }], refreshedAt: "2026-08-17T12:00:00Z" }) });
    });
    await page.locator(".admin-nav").getByRole("button", { name: "Steam 同步" }).click();
    await page.getByRole("button", { name: "刷新 Steam" }).click();
    await expect(page.locator(".admin-steam-sync-stats")).toContainText("24");
    await expect(page.locator(".admin-steam-sync-stats")).toContainText("2");
    expect(steamRefreshCount).toBe(1);
  });

  test("管理员端可删除访客留言，且不保留无功能导航项", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("alex-guestbook", JSON.stringify([
        { name: "访客 A", body: "第一条留言", date: "2026-08-17" },
        { name: "访客 B", body: "第二条留言", date: "2026-08-16" },
      ]));
    });
    await page.goto("/admin");

    const navigation = page.locator(".admin-nav");
    await expect(navigation.getByRole("button")).toHaveCount(7);
    await expect(navigation.getByRole("button", { name: "Steam 同步" })).toHaveCount(1);
    await expect(navigation.getByRole("button", { name: "媒体管理" })).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: "分类标签" })).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: "系统设置" })).toHaveCount(0);

    await navigation.getByRole("button", { name: "留言管理" }).click();
    const messageList = page.locator(".admin-message-list");
    await expect(messageList.locator(".admin-message-row")).toHaveCount(2);
    await messageList.getByRole("button", { name: "删除 访客 A 的留言" }).click();
    await expect(messageList.locator(".admin-message-row")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("alex-guestbook"))).not.toContain("第一条留言");
  });

  test("管理员端所有页面适配手机宽度", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");

    const navigation = page.locator(".admin-nav");
    for (const label of ["总览", "文章发布", "笔记发布", "图库发布", "项目同步", "Steam 同步", "留言管理"]) {
      await navigation.getByRole("button", { name: label }).click();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test("娱乐分区展示 Steam 游戏数据并适配手机宽度", async ({ page }) => {
    await page.route("**/api/steam/overview", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile: { steamId: "76561198000000000", name: "NextAlex Steam", profileUrl: "https://steamcommunity.com/id/nextalex", avatarUrl: "https://example.com/avatar.jpg", personaState: 1 }, gameCount: 2, totalPlaytime: 180, recentlyPlayed: [{ appId: 10, name: "Counter-Strike", playtimeForever: 120, playtime2Weeks: 30 }], games: [{ appId: 10, name: "Counter-Strike", playtimeForever: 120, playtime2Weeks: 30 }, { appId: 20, name: "Team Fortress", playtimeForever: 60, playtime2Weeks: 0 }] }) });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".main-nav").getByRole("tab", { name: "娱乐", exact: true }).click();

    const steamPage = page.locator(".steam-page");
    await expect(steamPage.getByRole("heading", { name: "NextAlex Steam" })).toBeVisible();
    await expect(steamPage.getByText("2", { exact: true })).toBeVisible();
    const libraryGame = steamPage.locator(".steam-section").last().locator('.steam-library-accordion-item[aria-label*="Counter-Strike"]');
    await expect(libraryGame).toBeVisible();
    await expect(libraryGame).toHaveAttribute("href", /store\.steampowered\.com\/app\/10/);
    await expect(libraryGame).toHaveAttribute("style", /steam\/apps\/10\/header\.jpg/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("创作中心展示 GitHub 快照统计", async ({ page }) => {
    await page.route("**/api/github/profile", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ username: "CbhHikari0828", repositoryCount: 12, stars: 70, forks: 18, followers: 32 }) });
    });
    await page.goto("/");
    await page.locator(".main-nav").getByRole("tab", { name: "创作中心", exact: true }).click();

    const stats = page.locator(".studio-stats");
    await expect(stats).toContainText("12");
    await expect(stats).toContainText("70");
    await expect(stats).toContainText("18");
    await expect(stats).toContainText("32");
  });

  test("快速连续导航最终停留在最后选择的页面", async ({ page }) => {
    await page.goto("/");

    const navigation = page.locator(".main-nav");
    await navigation.getByRole("tab", { name: "文章" }).click();
    await navigation.getByRole("tab", { name: "留言板" }).click();
    await navigation.getByRole("tab", { name: "创作图库" }).click();

    await expect(page.locator(".gallery-grid")).toBeVisible();
    await expect(navigation.getByRole("tab", { name: "创作图库" })).toHaveAttribute("aria-current", "page");
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
    await page.locator(".main-nav").getByRole("tab", { name: "创作图库", exact: true }).click();

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
    await page.locator(".main-nav").getByRole("tab", { name: "笔记", exact: true }).click();

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
    await page.locator(".main-nav").getByRole("tab", { name: "笔记", exact: true }).click();

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
    await page.locator(".main-nav").getByRole("tab", { name: "文章", exact: true }).click();

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

    await page.locator(".main-nav").getByRole("tab", { name: "创作图库", exact: true }).click();
    const creationTrigger = page.locator(".gallery-card-image").first();
    await creationTrigger.click();
    const detailTrigger = page.locator(".gallery-card-content button").first();
    await detailTrigger.click();

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
    await expect(detailTrigger).toBeFocused();
  });
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const articles = [
  {
    id: 1,
    slug: "source-article",
    title: "并发文章",
    category: "Java",
    series: "并发基础",
    tags: ["Java"],
    date: "2026-10-19",
    readTime: "6 min",
    views: 12,
    likes: 2,
    summary: "并发文章摘要",
    content: "## 可见性\n\nvolatile 可以保证变量的可见性。",
  },
  {
    id: 2,
    slug: "target-article",
    title: "线程池边界",
    category: "Java",
    series: "工程实践",
    tags: ["线程池"],
    date: "2026-10-18",
    readTime: "8 min",
    views: 8,
    likes: 1,
    summary: "线程池文章摘要",
    content: "## 拒绝策略\n\n队列达到容量后需要明确拒绝策略。",
  },
];

async function mockArticles(page: Page) {
  await page.route("**/api/articles", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(articles) });
  });
  await page.route(/\/api\/articles\/\d+\/view$/, async (route) => {
    const article = articles.find((item) => route.request().url().includes(`/articles/${item.id}/`)) || articles[0];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ views: article.views + 1, likes: article.likes }) });
  });
}

async function openArticleAssistant(page: Page) {
  await page.goto("/assistant");
  const input = page.getByLabel("向文章智能助手提问");
  await expect(input).toBeVisible();
  await expect(page.getByLabel("参考文章")).toHaveCount(0);
  return input;
}

test.describe("文章智能助手", () => {
  test("从文章列表右侧栏进入独立公共页，主导航和文章阅读器不保留入口", async ({ page }) => {
    await mockArticles(page);
    await page.goto("/articles");

    const articleAside = page.locator(".article-index > .article-aside");
    const assistantEntry = articleAside.getByRole("button", { name: "AI 助手", exact: true });
    await expect(articleAside).toBeVisible();
    await expect(assistantEntry).toBeVisible();
    await expect(assistantEntry).toHaveClass(/article-assistant-launch/);
    await expect(assistantEntry.locator(".article-assistant-launch-icon")).toHaveAttribute("src", "/infinity.svg");
    expect(await assistantEntry.evaluate((button) => {
      const aside = button.closest("aside");
      return Boolean(aside && aside.lastElementChild?.contains(button));
    })).toBe(true);
    await expect(page.locator(".main-nav").getByRole("tab", { name: "AI 助手", exact: true })).toHaveCount(0);

    await assistantEntry.click();
    await expect(page).toHaveURL(/\/assistant(?:\?.*)?$/);
    await expect(page.getByLabel("向文章智能助手提问")).toBeVisible();
    await expect(page.getByLabel("参考文章")).toHaveCount(0);
    await expect(page.getByText("选择一篇文章开始对话")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "文章智能助手" })).toHaveCount(0);
    await expect(page.locator(".article-assistant-backdrop")).toHaveCount(0);
    await expect(page.locator(".article-assistant-panel")).toBeVisible();

    await page.goto("/articles");
    await page.locator(".article-feed-item").filter({ hasText: "并发文章" }).click();

    const reader = page.locator(".article-reader");
    await expect(reader).toBeVisible();
    await expect(reader.locator(".article-assistant-entry")).toHaveCount(0);
    await expect(reader.getByText("文章智能助手", { exact: true })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: /开始对话|询问 AI|智能助手/ })).toHaveCount(0);
  });

  test("助手使用 ChatGPT 式工作台布局，并可返回文章列表", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockArticles(page);
    await page.route("**/api/assistant", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: delta\ndata: {\"content\":\"可以通过明确队列容量和拒绝策略来控制线程池边界。\"}\n\nevent: done\ndata: {\"sources\":[]}\n\n",
      });
    });
    await page.goto("/assistant");

    const workspace = page.locator(".assistant-page");
    const panel = page.locator(".article-assistant-panel");
    const composer = panel.locator(".article-assistant-composer");
    const backButton = page.getByRole("button", { name: "返回文章" });
    await expect(page.locator(".assistant-shell .site-header")).toBeHidden();
    await expect(workspace).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-empty/);
    await expect(backButton).toBeVisible();
    await expect(backButton.locator(".reply-icon")).toBeVisible();
    await expect(backButton.locator(".reply-icon svg path")).toHaveCount(2);
    await expect(backButton).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".assistant-shell .site-footer")).not.toBeVisible();
    await expect(page.locator(".assistant-page-title, .assistant-page-mark, .article-assistant-mark")).toHaveCount(0);

    const layout = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const panelWorkspace = element.querySelector<HTMLElement>(".article-assistant-workspace")!.getBoundingClientRect();
      const panelComposer = element.querySelector<HTMLElement>(".article-assistant-composer")!.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        composerCenterOffset: Math.abs((panelComposer.top + panelComposer.height / 2) - (panelWorkspace.top + panelWorkspace.height / 2)),
        workspaceHeight: panelWorkspace.height,
      };
    });
    expect(layout.width).toBeGreaterThan(layout.viewportWidth * .9);
    expect(layout.height).toBeGreaterThan(layout.viewportHeight * .7);
    expect(layout.composerCenterOffset).toBeLessThan(layout.workspaceHeight * .15);

    const input = page.getByLabel("向文章智能助手提问");
    const collapsedComposer = await composer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const textarea = element.querySelector<HTMLTextAreaElement>("textarea")!;
      const action = element.querySelector<HTMLButtonElement>("button")!;
      const textareaRect = textarea.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
        textareaCenter: textareaRect.top + textareaRect.height / 2,
        actionCenter: actionRect.top + actionRect.height / 2,
        textAlign: getComputedStyle(textarea).textAlign,
      };
    });
    expect(collapsedComposer.width / collapsedComposer.height).toBeGreaterThan(8);
    expect(collapsedComposer.borderRadius).toBeCloseTo(24, 0);
    expect(collapsedComposer.textAlign).toBe("left");
    expect(Math.abs(collapsedComposer.textareaCenter - collapsedComposer.actionCenter)).toBeLessThan(1);

    await input.fill(["第一行内容", "第二行内容", "第三行内容", "第四行内容"].join("\n"));
    await expect.poll(() => composer.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(70, 56, 255)");
    await expect.poll(() => composer.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(collapsedComposer.height + 40);
    const expandedComposer = await composer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius) };
    });
    expect(Math.abs(expandedComposer.top - collapsedComposer.top)).toBeLessThan(1);
    expect(expandedComposer.bottom).toBeGreaterThan(collapsedComposer.bottom + 40);
    expect(expandedComposer.borderRadius).toBeCloseTo(24, 0);

    await input.fill("线程池队列满了该怎么办？");
    await expect.poll(() => composer.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(expandedComposer.height);
    await input.press("Enter");
    await expect(panel).toHaveClass(/has-conversation/);
    await expect(panel.locator(".article-assistant-message")).toHaveCount(2);

    const conversationLayout = await panel.evaluate((element) => {
      const panelRect = element.getBoundingClientRect();
      const messageList = element.querySelector<HTMLElement>(".article-assistant-messages")!.getBoundingClientRect();
      const panelComposer = element.querySelector<HTMLElement>(".article-assistant-composer")!.getBoundingClientRect();
      return { panelBottom: panelRect.bottom, messageListBottom: messageList.bottom, composerTop: panelComposer.top, composerBottom: panelComposer.bottom };
    });
    expect(conversationLayout.panelBottom - conversationLayout.composerBottom).toBeLessThan(40);
    expect(conversationLayout.messageListBottom).toBeLessThanOrEqual(conversationLayout.composerTop + 1);

    await backButton.click();
    await expect(page).toHaveURL(/\/articles$/);
    await expect(page.locator(".article-index")).toBeVisible();
  });

  test("长输入会向下扩展并始终锁定在聊天框内", async ({ page }) => {
    await mockArticles(page);

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/assistant");

      const input = page.getByLabel("向文章智能助手提问");
      const composer = page.locator(".article-assistant-composer");
      await input.fill("unbroken-input-token-".repeat(45));

      const bounds = await composer.evaluate((element) => {
        const textarea = element.querySelector<HTMLTextAreaElement>("textarea")!;
        const composerRect = element.getBoundingClientRect();
        const textareaRect = textarea.getBoundingClientRect();
        return {
          composerScrollWidth: element.scrollWidth,
          composerClientWidth: element.clientWidth,
          composerLeft: composerRect.left,
          composerRight: composerRect.right,
          textareaScrollWidth: textarea.scrollWidth,
          textareaClientWidth: textarea.clientWidth,
          textareaLeft: textareaRect.left,
          textareaRight: textareaRect.right,
          textareaHeight: textareaRect.height,
          textareaMaxHeight: Number.parseFloat(getComputedStyle(textarea).maxHeight),
        };
      });

      expect(bounds.composerScrollWidth).toBeLessThanOrEqual(bounds.composerClientWidth + 1);
      expect(bounds.textareaScrollWidth).toBeLessThanOrEqual(bounds.textareaClientWidth + 1);
      expect(bounds.textareaLeft).toBeGreaterThanOrEqual(bounds.composerLeft);
      expect(bounds.textareaRight).toBeLessThanOrEqual(bounds.composerRight);
      expect(bounds.textareaHeight).toBeGreaterThan(34);
      expect(bounds.textareaHeight).toBeLessThanOrEqual(bounds.textareaMaxHeight + 1);
    }
  });

  test("发送图标在悬停和提交时播放，并在切换停止按钮前保留", async ({ page }) => {
    await mockArticles(page);
    let releaseResponse: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route("**/api/assistant", async (route) => {
      await responseGate;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: delta\ndata: {\"content\":\"已发送\"}\n\nevent: done\ndata: {\"sources\":[]}\n\n",
      });
    });
    await page.goto("/assistant");

    const input = page.getByLabel("向文章智能助手提问");
    const sendButton = page.getByRole("button", { name: "发送" });
    const plane = sendButton.locator(".send-icon g");
    await input.fill("测试发送图标动画");
    await expect(sendButton).toBeEnabled();
    await expect(sendButton.locator(".send-icon svg path")).toHaveCount(2);

    await sendButton.hover();
    await page.waitForTimeout(120);
    await expect.poll(() => plane.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");

    await sendButton.click();
    await expect(page.locator(".article-assistant-send .send-icon")).toBeVisible();
    await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 2_000 });

    releaseResponse!();
    await expect(page.locator(".article-assistant-panel")).toContainText("已发送");
  });

  test("流式展示答案和引用，引用可打开对应文章而不离开助手页", async ({ page }) => {
    await mockArticles(page);
    let requestBody: unknown;
    await page.route("**/api/assistant", async (route) => {
      requestBody = route.request().postDataJSON();
      const source = { id: "S1", articleId: 2, slug: "target-article", title: "线程池边界", excerpt: "队列达到容量后需要明确拒绝策略。" };
      const followupSource = { ...source, id: "S2", excerpt: "拒绝策略需要与业务降级方案一起设计。" };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body: [
          `event: sources\r\ndata: ${JSON.stringify({ sources: [source, followupSource] })}\r\n\r\n`,
          `event: delta\r\ndata: ${JSON.stringify({ content: "根据文章，" })}\r\n\r\n`,
          `event: delta\r\ndata: ${JSON.stringify({ content: "需要明确拒绝策略。[S2]" })}\r\n\r\n`,
          `event: done\r\ndata: ${JSON.stringify({ sources: [source, followupSource] })}\r\n\r\n`,
        ].join(""),
      });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await expect(panel).toBeVisible();
    await input.fill("队列满了以后怎么办？");
    await input.press("Enter");

    await expect(panel).toContainText("根据文章，需要明确拒绝策略。[S2]");
    const sourceIntro = panel.locator(".article-assistant-answer-intro");
    await expect(sourceIntro).toContainText("这个问题可在");
    await expect(sourceIntro).toContainText("线程池边界");
    await expect(sourceIntro).toContainText("引用片段：[S1]、[S2]");
    await expect(sourceIntro).toContainText("下面是具体讲解：");
    const sourceButton = sourceIntro.getByRole("button", { name: "打开文章《线程池边界》" });
    await expect(sourceButton).toBeVisible();
    await expect(panel.locator(".article-assistant-sources")).toHaveCount(0);
    expect(await panel.locator(".article-assistant-answer-intro").evaluate((intro) => {
      const answer = intro.parentElement?.querySelector(".article-assistant-answer");
      return Boolean(answer && (intro.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    expect(requestBody).toEqual({ message: "队列满了以后怎么办？", history: [] });

    await sourceButton.click();
    await expect(page.locator(".article-reader-intro h1")).toHaveText("线程池边界");
    await expect(page).toHaveURL(/\/assistant/);
    await expect(page.locator(".article-assistant-panel")).toBeVisible();
  });

  test("流式回答支持 Markdown 标题、列表、链接、表格和高亮代码块", async ({ page }) => {
    await mockArticles(page);
    await page.route("**/api/assistant", async (route) => {
      const markdown = [
        "## 处理步骤",
        "",
        "1. 先设置有界队列",
        "2. 再配置拒绝策略",
        "",
        "可继续阅读[线程池文章](https://example.com/articles/thread-pool)。",
        "",
        "| 配置 | 作用 |",
        "| --- | --- |",
        "| queue | 限制积压 |",
        "",
        "```ts",
        "const queueSize = 100;",
        "```",
      ].join("\n");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `event: delta\ndata: ${JSON.stringify({ content: markdown })}\n\n`,
          "event: done\ndata: {\"sources\":[]}\n\n",
        ].join(""),
      });
    });

    const input = await openArticleAssistant(page);
    await input.fill("如何配置线程池？");
    await input.press("Enter");

    const answer = page.locator(".article-assistant-message.is-assistant .article-assistant-answer");
    await expect(answer.locator("h2")).toHaveText("处理步骤");
    await expect(answer.locator("ol > li")).toHaveCount(2);
    await expect(answer.getByRole("link", { name: "线程池文章" })).toHaveAttribute("href", "https://example.com/articles/thread-pool");
    await expect(answer.locator("table")).toContainText("限制积压");
    await expect(answer.locator("pre code.hljs")).toContainText("const queueSize = 100;");
  });

  test("多篇命中文章默认收起其他文章，并按文章聚合引用片段", async ({ page }) => {
    await mockArticles(page);
    await page.route("**/api/assistant", async (route) => {
      const primarySource = { id: "S1", articleId: 2, slug: "target-article", title: "线程池边界", excerpt: "队列达到容量后需要明确拒绝策略。" };
      const otherSource = { id: "S2", articleId: 1, slug: "source-article", title: "并发文章", excerpt: "共享状态需要明确可见性边界。" };
      const otherChunk = { ...otherSource, id: "S3", excerpt: "volatile 可以保证变量的可见性。" };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `event: sources\ndata: ${JSON.stringify({ sources: [primarySource, otherSource, otherChunk] })}\n\n`,
          `event: delta\ndata: ${JSON.stringify({ content: "先处理队列饱和，再检查共享状态的可见性。" })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ sources: [primarySource, otherSource, otherChunk] })}\n\n`,
        ].join(""),
      });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await input.fill("线程池和可见性应该如何一起考虑？");
    await input.press("Enter");

    const sourceIntro = panel.locator(".article-assistant-answer-intro");
    await expect(sourceIntro).toContainText("线程池边界");
    await expect(sourceIntro).toContainText("引用片段：[S1]");
    await expect(sourceIntro.getByRole("button", { name: "打开文章《线程池边界》" })).toBeVisible();

    const additionalSources = panel.locator("details.article-assistant-sources");
    await expect(additionalSources).toHaveCount(1);
    await expect(additionalSources).not.toHaveAttribute("open", "");
    await expect(additionalSources.locator("summary")).toContainText("其他参考文章");
    await expect(additionalSources.locator("summary")).toContainText("1");
    const groupedArticle = additionalSources.locator(".article-assistant-sources-list > button");
    await expect(groupedArticle).toHaveCount(1);
    await expect(groupedArticle).toHaveAttribute("aria-label", "打开文章《并发文章》，引用 [S2]、[S3]");

    await additionalSources.locator("summary").click();
    await expect(additionalSources).toHaveAttribute("open", "");
    await expect(groupedArticle).toBeVisible();
    await groupedArticle.click();
    await expect(page.locator(".article-reader-intro h1")).toHaveText("并发文章");
    await expect(page).toHaveURL(/\/assistant/);
  });

  test("全站知识库请求不携带文章 ID", async ({ page }) => {
    await mockArticles(page);
    let requestBody: unknown;
    await page.route("**/api/assistant", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: delta\ndata: {\"content\":\"可根据队列容量和降级策略选择拒绝方式。\"}\n\nevent: done\ndata: {\"sources\":[]}\n\n",
      });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await expect(panel).toBeVisible();
    await input.fill("拒绝策略如何选择？");
    await input.press("Enter");

    await expect.poll(() => requestBody).toEqual({ message: "拒绝策略如何选择？", history: [] });
  });

  test("支持在独立页停止生成，并在手机宽度保持无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockArticles(page);
    let releaseResponse: (() => void) | undefined;
    await page.route("**/api/assistant", async (route) => {
      await new Promise<void>((resolve) => { releaseResponse = resolve; });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: done\ndata: {\"sources\":[]}\n\n",
      }).catch(() => undefined);
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await expect(panel).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await input.fill("解释可见性");
    await input.press("Enter");
    await expect(panel.getByRole("button", { name: "停止" })).toBeVisible();
    await expect(panel.locator(".article-assistant-thinking")).toContainText("正在检索文章");
    await panel.getByRole("button", { name: "停止" }).click();
    releaseResponse?.();
    await expect(panel.getByText("已停止生成")).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator(".article-assistant-backdrop")).toHaveCount(0);
  });

  test("请求失败时展示错误并保留待重试的问题", async ({ page }) => {
    await mockArticles(page);
    await page.route("**/api/assistant", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "model_unavailable", message: "模型服务暂时不可用" }),
      });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await expect(panel).toBeVisible();
    await input.fill("什么是可见性？");
    await input.press("Enter");

    await expect(panel.getByRole("alert")).toHaveText("模型服务暂时不可用");
    await expect(input).toHaveValue("什么是可见性？");
    await expect(input).toBeFocused();
    await expect(panel.locator(".article-assistant-message")).toHaveCount(0);
  });

  test("完成事件未返回正文时不展示仅来源的答案", async ({ page }) => {
    await mockArticles(page);
    await page.route("**/api/assistant", async (route) => {
      const source = { id: "S1", articleId: 2, slug: "target-article", title: "线程池边界", excerpt: "队列达到容量后需要明确拒绝策略。" };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\nevent: delta\ndata: ${JSON.stringify({ content: "  \n\t" })}\n\nevent: done\ndata: ${JSON.stringify({ sources: [source] })}\n\n`,
      });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await input.fill("队列满了以后怎么办？");
    await input.press("Enter");

    await expect(panel.getByRole("alert")).toHaveText("智能助手未返回讲解正文，请重试");
    await expect(input).toHaveValue("队列满了以后怎么办？");
    await expect(input).toBeFocused();
    await expect(panel.locator(".article-assistant-message")).toHaveCount(0);
    await expect(panel.locator(".article-assistant-answer-intro")).toHaveCount(0);
    await expect(panel.locator(".article-assistant-sources")).toHaveCount(0);
  });

  test("仅发送最近八条且遵守 rune 预算，并在流式断开时保留已生成内容", async ({ page }) => {
    await mockArticles(page);
    const requestBodies: Array<{ message: string; history: Array<{ role: string; content: string }> }> = [];
    await page.route("**/api/assistant", async (route) => {
      const body = route.request().postDataJSON() as { message: string; history: Array<{ role: string; content: string }> };
      requestBodies.push(body);
      const sequence = requestBodies.length;
      const answer = `回答 ${sequence} ${"并".repeat(1500)}`;
      const events = sequence < 6
        ? `event: delta\ndata: ${JSON.stringify({ content: answer })}\n\nevent: done\ndata: {"sources":[]}\n\n`
        : `event: delta\ndata: ${JSON.stringify({ content: "未完成的回答" })}\n\n`;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: events });
    });

    const input = await openArticleAssistant(page);
    const panel = page.locator(".article-assistant-panel");
    await expect(panel).toBeVisible();
    for (let index = 1; index <= 6; index += 1) {
      await input.fill(`问题 ${index}`);
      await input.press("Enter");
      if (index < 6) await expect(panel.locator(".article-assistant-answer").filter({ hasText: `回答 ${index}` }).last()).toBeVisible();
    }

    await expect(panel.getByText("未完成的回答", { exact: true })).toBeVisible();
    await expect(panel.getByRole("alert")).toHaveText("回答连接意外中断，请重试");
    const history = requestBodies[5].history;
    const historyRunes = history.reduce((total, item) => total + Array.from(item.content).length, 0);
    expect(history.length).toBeLessThanOrEqual(8);
    expect(historyRunes).toBeLessThanOrEqual(5600);
    expect(history.map((item) => item.content.slice(0, 5))).toEqual([
      "问题 3",
      "回答 3 ",
      "问题 4",
      "回答 4 ",
      "问题 5",
      "回答 5 ",
    ]);
  });
});

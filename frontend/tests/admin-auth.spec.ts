import { expect, test } from "@playwright/test";

const authenticatedSession = { authenticated: true, username: "alexlee" };

test.describe("管理端登录", () => {
  test("未登录时显示登录页并反馈错误凭据", async ({ page }) => {
    await page.route("**/api/admin/session", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
    });
    await page.route("**/api/admin/login", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ username: "alexlee", password: "wrong-password" });
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid credentials" }) });
    });

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.locator(".admin-nav")).toHaveCount(0);
    await page.getByLabel("账号").fill("alexlee");
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("账号或密码错误");
  });

  test("凭据正确后进入管理后台", async ({ page }) => {
    await page.route("**/api/admin/session", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
    });
    await page.route("**/api/admin/login", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ username: "alexlee", password: "alexlee" });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(authenticatedSession) });
    });

    await page.goto("/admin");
    await page.getByLabel("账号").fill("alexlee");
    await page.getByLabel("密码").fill("alexlee");
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator(".admin-module-grid")).toBeVisible();
    await expect(page.locator(".admin-account")).toContainText("alexlee");
  });

  test("已登录管理员可以退出", async ({ page }) => {
    await page.route("**/api/admin/session", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(authenticatedSession) });
    });
    await page.route("**/api/admin/logout", async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({ status: 204 });
    });

    await page.goto("/admin");
    await page.getByRole("button", { name: "退出登录" }).click();

    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "管理后台" })).toBeVisible();
    await expect(page.locator(".admin-nav")).toHaveCount(0);
  });

  test("管理接口返回 401 时统一退回登录页", async ({ page }) => {
    await page.route("**/api/admin/session", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(authenticatedSession) });
    });
    await page.route("**/api/admin/articles", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
    });

    await page.goto("/admin");
    await page.getByRole("button", { name: "文章发布" }).first().click();

    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("alert")).toHaveText("登录状态已失效，请重新登录");
    await expect(page.locator(".admin-nav")).toHaveCount(0);
  });
});

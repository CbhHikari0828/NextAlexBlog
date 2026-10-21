# NextAlex Blog

NextAlex Blog 是一个个人博客与创作展示站点，前台用于展示技术文章、日常笔记、创作图库、创作中心、娱乐专栏和留言墙；后台用于发布内容、同步外部数据和管理站点资料。

## 项目结构

- `frontend/`：React + TypeScript + Vite 前端，开发时运行在 Docker 容器中。
- `backend/`：Go + Gin API，作为 Compose 服务构建并运行。
- `database/`：PostgreSQL 初始化脚本和数据库说明。
- `docker-compose.yml`：PostgreSQL、后端和前端容器编排。

## 本地启动

1. 如需自定义配置，复制 `.env.example` 为 `.env` 并修改对应环境变量。
2. 构建并启动 PostgreSQL、后端和前端服务：

   ```powershell
   docker compose up --build -d
   ```

3. 打开 `http://localhost:5173`；管理端地址为 `http://localhost:5173/admin`，开发环境默认账号和密码均为 `alexlee`。

默认情况下，前端源码目录会挂载到容器内，Vite 使用轮询触发 HMR；前端容器会把 `/api` 请求代理到 Compose 内的后端服务。前端、后端和 PostgreSQL 分别暴露在宿主机 `5173`、`8090` 和 `55432` 端口。

## 镜像部署

生产部署使用三个镜像：`nextalexblog-postgres`（包含初始化 SQL）、`nextalexblog-backend` 和 `nextalexblog-frontend`。前端镜像由 Nginx 提供静态资源，并在容器网络内把 `/api` 反向代理到后端；生产环境仅暴露前端端口，数据库和后端不直接对公网开放。

图库图片存储在阿里云 OSS，不使用 MinIO，也不存入 PostgreSQL。部署前将 `.env.production.example` 复制为 `.env.production`，填入镜像仓库、数据库强密码、管理端会话密钥和 `DEEPSEEK_API_KEY`，以及实际需要的 OSS、SMTP、Steam 配置。管理端账号和密码默认均为 `alexlee`，生产部署建议通过 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 覆盖默认值。

构建并推送镜像：

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.images.yml build
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.images.yml push
```

在部署服务器上只拉取并运行镜像：

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

## 当前功能

项目当前包括：

- 首页：个人介绍、3D 小地球模型、横向滚动叙事、文章入口和全局鼠标尾迹。
- 管理后台：访问 `/admin` 时需要登录，登录状态由后端签发的 HttpOnly Cookie 维护，退出后立即失效。
- 文章：内容、分类、标签和发布状态持久化在 PostgreSQL；后台支持草稿、发布、编辑和删除，前台支持分类/专栏筛选、浏览量和轻量点赞。
- 文章智能助手：从文章列表右侧栏进入全站文章知识库；回答只检索已发布文章并通过 DeepSeek 流式返回，附带可跳转的引用来源。
- 笔记：支持从后台发布 Markdown 笔记、列出已发布笔记并删除，前台以自适应卡片展示。
- 创作图库：图片上传到阿里云 OSS，元数据写入 PostgreSQL，后台可预览、编辑和删除。
- 创作中心：展示 GitHub 快照数据、贡献热力图和项目状态。
- 娱乐专栏：展示 Steam 游戏库快照、音乐偏好、开源工具和中国地图轨迹。
- 音乐管理：支持导入公开 Apple Music、QQ 音乐、网易云音乐页面元数据，保存到数据库后前台展示。
- 开源工具管理：输入 GitHub 项目地址后自动读取项目名和作者，描述由后台填写，可选择隐藏。
- 留言墙：访客留言写入 PostgreSQL，并支持异步 Gmail SMTP 邮件通知。

## 数据刷新策略

项目尽量避免前台每次访问都请求第三方平台：

- GitHub 数据通过 `POST /api/admin/github/refresh` 刷新快照，前台只读取数据库快照。
- Steam 数据通过 `POST /api/admin/steam/refresh` 刷新快照，前台只读取数据库快照。
- 音乐和开源工具在后台导入或保存后写入 PostgreSQL，前台直接读取已持久化数据。
- 图库图片存储在 OSS，图库元数据存储在 PostgreSQL。

## 常用接口

- `GET /api/health`：检查后端和数据库状态。
- `GET /api/articles`、`GET /api/articles/:id`：读取已发布文章。
- `POST /api/articles/:id/view`、`POST /api/articles/:id/like`：记录文章浏览和点赞计数。
- `GET /api/gallery`：读取已发布图库。
- `GET /api/notes`：读取已发布笔记。
- `GET /api/music`：读取音乐偏好。
- `GET /api/open-source-tools`：读取未隐藏的开源工具。
- `GET /api/guestbook/messages`：读取留言墙。
- `POST /api/guestbook/messages`：提交留言。
- `GET /api/github/profile`、`GET /api/github/repositories`、`GET /api/github/contributions`：读取 GitHub 快照。
- `GET /api/steam/overview`：读取 Steam 快照。
- `POST /api/assistant`：基于所有已发布文章检索上下文，并以 SSE 流式返回文章助手回答和引用来源。
- `POST /api/articles/:id/assistant`：保留为兼容接口，会优先检索指定的已发布文章。
- `POST /api/admin/login`：校验管理端账号和密码，并设置 HttpOnly 会话 Cookie。
- `GET /api/admin/session`：检查当前管理端会话。
- `POST /api/admin/logout`：退出管理端并清除会话 Cookie。

后台接口集中在 `/api/admin/*`，包括 `GET/POST/PUT/DELETE /api/admin/articles`、`POST/DELETE /api/admin/notes`、图库管理、音乐导入、GitHub/Steam 刷新、开源工具管理和留言删除。除登录、会话检查和退出接口外，所有管理业务接口都必须通过后端签发的 HttpOnly 会话 Cookie 认证。

## 环境变量

主要配置项放在 `.env` 或后端运行环境中：

- `DATABASE_URL`：Go 后端连接 PostgreSQL 的地址。
- `POSTGRES_PORT`：本地 PostgreSQL 映射端口，默认 `55432`。
- `ADMIN_USERNAME`、`ADMIN_PASSWORD`：管理端登录凭据，默认均为 `alexlee`；生产环境建议覆盖。
- `ADMIN_SESSION_SECRET`：管理端会话签名密钥；生产 Compose 要求显式配置为足够长的随机值。
- `ADMIN_COOKIE_SECURE`：是否仅通过 HTTPS 发送管理端 Cookie；开发环境默认 `false`，生产环境默认 `true`。
- `GITHUB_USERNAME`：GitHub 快照刷新使用的公开用户名。
- `STEAM_ID`、`STEAM_WEB_API_KEY`：Steam 快照刷新配置。
- `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_PUBLIC_BASE_URL`：图库 OSS 存储配置。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`NOTIFICATION_TO_EMAIL`：留言邮件通知配置；发件人使用 `SMTP_USERNAME`。
- `DEEPSEEK_API_KEY`：文章智能助手调用 DeepSeek 所需的服务端密钥；不要放入前端代码或提交到 Git。
- `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_SECONDS`、`DEEPSEEK_MAX_OUTPUT_TOKENS`：可选的 DeepSeek 接口地址、模型、超时和输出上限；默认分别为 `https://api.deepseek.com`、`deepseek-v4-pro`、`45` 秒和 `1200`。

## 数据库说明

初始化 SQL 位于 `database/init/`。PostgreSQL 只会在首次创建数据卷时执行初始化脚本，之后重启容器会保留 `postgres_data` 卷中的已有数据。

后端启动时会执行非破坏性文章 schema 补齐，并通过迁移记录幂等导入历史前端文章；已有文章不会被重复导入或覆盖。

如需重新初始化数据库，需要先明确备份和清理数据卷，再重新启动服务。

## 维护记录

- 2026-09-20：完成站点身份展示名称更新为 Cameron，并同步整理文章分类与专栏的层级导航。

## 日常维护清单

- 前端调整后执行 `npm.cmd run build`，确认 TypeScript 检查与 Vite 生产构建均通过。
- 后端接口调整后执行 `go test ./...`，再检查数据库连接和快照接口状态。
- GitHub、Steam 等外部数据通过管理后台刷新，前台继续读取数据库快照，避免重复请求第三方服务。
- 图片和媒体资源优先使用对象存储，数据库只保存可检索的元数据与公开访问地址。
- 发布前只提交本次变更文件，并保持 `master` 与 `main` 分支同步。
- 提交前检查前端路由、后台快照接口和生产构建产物，确保文档记录与实际运行方式一致。
- 交互效果遵循渐进增强：动画不可用时仍保证内容、导航和表单可访问。
- 性能排查优先观察布局抖动、重复请求、超大资源和长任务，再决定是否引入新的动效或依赖。
- 数据发布遵循“先持久化、后展示”原则，外部服务异常时保留最近一次有效快照并给出可理解的状态。
- 回滚时优先恢复最近一个可构建提交，不直接清理数据库卷或覆盖对象存储中的历史资源。
- 贡献绿墙刷新遵循“可用优先”：刷新失败时继续展示最近一次快照，并在后台记录失败原因，不让空数据覆盖有效记录。
- 依赖升级采用小步提交，先锁定版本并完成前端构建、后端测试和关键页面检查，再合并到主分支。
- 维护提交保持单一目的，提交信息说明实际变更，方便按功能定位、回滚和追踪后续问题。

- 2026-09-21：补充日常构建、接口检查、快照刷新和分支同步维护约定。
- 2026-09-22：补充发布前路由、接口和构建产物核对项。
- 2026-09-23：补充渐进增强、性能排查、快照容错和发布回滚原则。
- 2026-09-23：补充绿墙快照保留、依赖升级和单一目的提交约定。

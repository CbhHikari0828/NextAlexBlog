# NextAlex Blog

NextAlex Blog 是一个个人博客与创作展示站点，前台用于展示技术文章、日常笔记、创作图库、创作中心、娱乐专栏和留言墙；后台用于发布内容、同步外部数据和管理站点资料。

## 项目结构

- `frontend/`：React + TypeScript + Vite 前端，开发时运行在 Docker 容器中。
- `backend/`：Go + Gin API，开发时建议直接在宿主机运行，方便调试断点和日志。
- `database/`：PostgreSQL 初始化脚本和数据库说明。
- `docker-compose.yml`：开发环境中的 PostgreSQL 和前端容器编排。

## 本地启动

1. 如需自定义配置，复制 `.env.example` 为 `.env` 并修改对应环境变量。
2. 启动 PostgreSQL 和前端开发服务：

   ```powershell
   docker compose up --build postgres frontend
   ```

3. 另开一个终端启动 Go 后端：

   ```powershell
   cd backend
   go run ./cmd/server
   ```

4. 打开 `http://localhost:5173`。

默认情况下，前端源码目录会挂载到容器内，Vite 使用轮询触发 HMR；前端容器会把 `/api` 请求代理到宿主机的 `http://host.docker.internal:8090`，PostgreSQL 暴露在宿主机 `localhost:55432`。

## 当前功能

项目当前包括：

- 首页：个人介绍、3D 小地球模型、横向滚动叙事、文章入口和全局鼠标尾迹。
- 文章：支持分类和专栏两级筛选，支持 `/articles?category=...&series=...` 形式的链接访问与刷新恢复。
- 笔记：支持从后台发布 Markdown 笔记，前台以自适应卡片展示。
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
- `GET /api/gallery`：读取已发布图库。
- `GET /api/notes`：读取已发布笔记。
- `GET /api/music`：读取音乐偏好。
- `GET /api/open-source-tools`：读取未隐藏的开源工具。
- `GET /api/guestbook/messages`：读取留言墙。
- `POST /api/guestbook/messages`：提交留言。
- `GET /api/github/profile`、`GET /api/github/repositories`、`GET /api/github/contributions`：读取 GitHub 快照。
- `GET /api/steam/overview`：读取 Steam 快照。

后台接口集中在 `/api/admin/*`，包括文章/笔记发布、图库管理、音乐导入、GitHub/Steam 刷新、开源工具管理和留言删除。

## 环境变量

主要配置项放在 `.env` 或后端运行环境中：

- `DATABASE_URL`：Go 后端连接 PostgreSQL 的地址。
- `POSTGRES_PORT`：本地 PostgreSQL 映射端口，默认 `55432`。
- `GITHUB_USERNAME`：GitHub 快照刷新使用的公开用户名。
- `STEAM_ID`、`STEAM_WEB_API_KEY`：Steam 快照刷新配置。
- `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_PUBLIC_BASE_URL`：图库 OSS 存储配置。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM`、`SMTP_TO`：留言邮件通知配置。

## 数据库说明

初始化 SQL 位于 `database/init/`。PostgreSQL 只会在首次创建数据卷时执行初始化脚本，之后重启容器会保留 `postgres_data` 卷中的已有数据。

如需重新初始化数据库，需要先明确备份和清理数据卷，再重新启动服务。

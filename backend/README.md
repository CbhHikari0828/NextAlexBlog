# Backend

The Go API uses Gin and can run either in the development Compose stack or directly on the host for local debugging.

From this directory:

```powershell
go mod tidy
go run ./cmd/server
```

The API listens on `http://localhost:8090`.

- `GET /api/health`: reports database availability.
- `POST /api/admin/login`: validates the admin username and password and sets an HttpOnly session cookie.
- `GET /api/admin/session`: reports whether the current admin session is authenticated.
- `POST /api/admin/logout`: clears the admin session cookie.
- `GET /api/github/contributions?year=2026`: returns the contribution calendar from the PostgreSQL GitHub snapshot. It never requests GitHub.
- `GET /api/github/repositories?limit=3`: returns repositories from the PostgreSQL GitHub snapshot. It never requests GitHub.
- `GET /api/github/profile`: returns profile statistics from the PostgreSQL GitHub snapshot. It never requests GitHub.
- `POST /api/admin/github/refresh`: requests the configured GitHub account once and replaces the PostgreSQL snapshot with the profile, repositories, and contribution calendar.
- `GET /api/steam/overview`: returns the Steam snapshot stored in PostgreSQL. This endpoint never requests the Steam Web API.
- `POST /api/admin/steam/refresh`: requests Steam once and replaces the stored snapshot. Use this from the admin Steam sync screen.
- `GET /api/music`: returns music preferences stored in PostgreSQL.
- `POST /api/admin/music/import`: imports public metadata from an HTTPS Apple Music, QQ Music, or NetEase Cloud Music URL and stores it in PostgreSQL. Only public page metadata is read; no platform API key or login session is required.
- `DELETE /api/admin/music/:id`: removes a stored music preference.
- `GET /api/gallery`: returns published AI gallery records stored in PostgreSQL.
- `POST /api/admin/gallery`: uploads a gallery image to Alibaba Cloud OSS and stores its metadata in PostgreSQL. The multipart image is limited to 10 MB.
- `POST /api/assistant`: streams a grounded answer as SSE after retrieving relevant chunks from all published articles. Events are `sources`, `delta`, `done`, and `error`.
- `POST /api/articles/:id/assistant`: remains available as a compatibility endpoint and prioritizes the specified published article.
- `GET /api/notes`: returns published notes stored in PostgreSQL.
- `POST /api/admin/notes`: publishes a Markdown note to PostgreSQL.

All admin business endpoints under `/api/admin/*` require the signed HttpOnly session cookie; the login, session check, and logout endpoints provide the authentication lifecycle. The development username and password both default to `alexlee`. Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a long random `ADMIN_SESSION_SECRET` in production, and keep `ADMIN_COOKIE_SECURE=true` when the site is served over HTTPS. Credentials and the session secret belong only in the backend environment and must never be added to frontend files or committed to Git.

Gallery image storage uses Alibaba Cloud OSS. Configure `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, and `OSS_ACCESS_KEY_SECRET` in the backend environment; optionally set `OSS_PUBLIC_BASE_URL` for a custom domain or CDN. Credentials stay on the Go backend and are never sent to the browser. The backend does not fall back to local image storage when OSS is not configured.

The article assistant uses DeepSeek's OpenAI-compatible chat completion endpoint. Configure `DEEPSEEK_API_KEY`; `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TIMEOUT_SECONDS`, and `DEEPSEEK_MAX_OUTPUT_TOKENS` are optional (the local default model is `deepseek-v4-pro`). The API key stays in the backend environment. Global retrieval is local, only reads `published` articles, and ranks evidence by question relevance. Requests are limited to six per client IP per minute and four concurrent model calls per backend instance.

The contribution calendar defaults to `CbhHikari0828`. To use another public account during startup:

```powershell
$env:GITHUB_USERNAME = "your-github-username"
go run ./cmd/server
```

To enable the Steam entertainment page, configure a public SteamID64 and the API key only in the server environment:

```powershell
$env:STEAM_ID = "your-steamid64"
$env:STEAM_WEB_API_KEY = "your-steam-web-api-key"
go run ./cmd/server
```

Steam profile and game details must be public. The server creates the snapshot table automatically on startup, and Steam is only contacted when the admin refresh action is used. Do not add the API key to frontend files or Git.

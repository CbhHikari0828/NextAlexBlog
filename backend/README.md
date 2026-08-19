# Backend

The Go API uses Gin and is intentionally started on the host during development. This keeps breakpoints, logs, and the debugger local while the frontend and PostgreSQL remain in Docker.

From this directory:

```powershell
go mod tidy
go run ./cmd/server
```

The API listens on `http://localhost:8090`.

- `GET /api/health`: reports database availability.
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
- `GET /api/notes`: returns published notes stored in PostgreSQL.
- `POST /api/admin/notes`: publishes a Markdown note to PostgreSQL.

Gallery image storage uses Alibaba Cloud OSS. Configure `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, and `OSS_ACCESS_KEY_SECRET` in the backend environment; optionally set `OSS_PUBLIC_BASE_URL` for a custom domain or CDN. Credentials stay on the Go backend and are never sent to the browser. The backend does not fall back to local image storage when OSS is not configured.

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

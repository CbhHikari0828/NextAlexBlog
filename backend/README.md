# Backend

The Go API uses Gin and is intentionally started on the host during development. This keeps breakpoints, logs, and the debugger local while the frontend and PostgreSQL remain in Docker.

From this directory:

```powershell
go mod tidy
go run ./cmd/server
```

The API listens on `http://localhost:8090`.

- `GET /api/health`: reports database availability.
- `GET /api/github/contributions?year=2026`: returns the public GitHub contribution calendar for the configured account. Responses are cached in memory for 15 minutes.
- `GET /api/github/repositories?limit=3`: returns recently updated public repositories for the configured account. Responses are cached in memory for 15 minutes.
- `GET /api/steam/overview`: returns the Steam snapshot stored in PostgreSQL. This endpoint never requests the Steam Web API.
- `POST /api/admin/steam/refresh`: requests Steam once and replaces the stored snapshot. Use this from the admin Steam sync screen.

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

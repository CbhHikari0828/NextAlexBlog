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

The contribution calendar defaults to `CbhHikari0828`. To use another public account during startup:

```powershell
$env:GITHUB_USERNAME = "your-github-username"
go run ./cmd/server
```

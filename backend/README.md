# Backend

The Go API uses Gin and is intentionally started on the host during development. This keeps breakpoints, logs, and the debugger local while the frontend and PostgreSQL remain in Docker.

From this directory:

```powershell
go mod tidy
go run ./cmd/server
```

The API listens on `http://localhost:8090`. The initial endpoint is `GET /api/health`.

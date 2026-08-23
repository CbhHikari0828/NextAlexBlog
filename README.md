# Personal Blog

This repository is split into three independent parts:

- `frontend/`: React + TypeScript + Vite. It runs in Docker during development.
- `backend/`: Go API. It runs directly on the host for local debugging.
- `database/`: PostgreSQL initialization scripts and database documentation.

## Local development

1. Copy `.env.example` to `.env` when custom local values are needed.
2. Start the only Docker services used by development:

   ```powershell
   docker compose up --build postgres frontend
   ```

3. In another terminal, start the Go API:

   ```powershell
   cd backend
   go run ./cmd/server
   ```

4. Open http://localhost:5173.

The frontend source directory is bind-mounted into the container. Vite uses polling in the container, so edits made on the host trigger HMR in the browser. Requests to `/api` are proxied from the frontend container to the host Go API at `host.docker.internal:8090`.

## Frontend demo scope

The current frontend is a content-first demo with local sample data. It includes:

- Home: featured article, selected creations, notes, and a guestbook entry point.
- Articles: article list with topic filters such as `JUC 基础`, `异步工具箱`, and `系统设计`.
- Notes: short-form personal notes and fragments.
- Creation gallery: AI image and visual experiment showcase.
- Creation center: AI programming project statuses and project details.
- Guestbook: visitor name/message form with browser `localStorage` persistence.

Article details, creation metadata, authentication, and guestbook persistence are intentionally left as the next Gin API integration step. The frontend still checks `/api/health` and displays whether the backend is online; the demo content does not depend on that API yet.

The PostgreSQL service is available to the host backend at `localhost:55432` by default. Set `POSTGRES_PORT` and the matching `DATABASE_URL` in `.env` to use another port. Before starting containers, verify the selected host port is free; do not stop unrelated services to reclaim it. The default development connection string is in `.env.example`.

Database initialization scripts run only when PostgreSQL creates a fresh data volume. Existing data is kept in the named `postgres_data` volume.

## Current status

The project currently includes Markdown article import in the admin editor and Alibaba Cloud OSS-backed image storage for the creation gallery. Gallery uploads are published for browser access, while metadata remains in PostgreSQL.

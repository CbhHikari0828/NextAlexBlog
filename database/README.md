# Database

PostgreSQL is started by the root `docker-compose.yml` and is exposed on host port `55432` by default. Set `POSTGRES_PORT` in the root `.env` before starting it if that port is already in use. Initialization SQL is kept in `init/` so database-related files remain isolated from the frontend and Go service.

The first script creates the blog's initial tables. PostgreSQL executes scripts in `/docker-entrypoint-initdb.d` only for a new data volume; normal container restarts preserve data.

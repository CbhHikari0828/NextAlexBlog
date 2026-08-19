CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS posts_status_published_at_idx
    ON posts (status, published_at DESC);

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tags (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_categories (
    post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, category_id)
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS steam_overview_snapshots (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    payload JSONB NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS github_overview_snapshots (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    payload JSONB NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS music_preferences (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    release_date TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    external_url TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery_creations (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    note_date DATE NOT NULL,
    content_markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notes_note_date_idx
    ON notes (note_date DESC, id DESC);

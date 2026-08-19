package main

import (
	"bufio"
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/net/html"
)

var contributionCountPattern = regexp.MustCompile(`([0-9][0-9,]*)\s+contribution`)
var steamIDPattern = regexp.MustCompile(`^\d{17}$`)
var isoDurationPattern = regexp.MustCompile(`^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$`)

const maxGalleryImageSize int64 = 10 * 1024 * 1024

type contributionDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
	Level int    `json:"level"`
}

type githubContributions struct {
	Username string            `json:"username"`
	Year     int               `json:"year"`
	Total    int               `json:"total"`
	Days     []contributionDay `json:"days"`
}

type githubRepository struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	HTMLURL     string `json:"htmlUrl"`
	Language    string `json:"language"`
	Stars       int    `json:"stars"`
	Forks       int    `json:"forks"`
	UpdatedAt   string `json:"updatedAt"`
}

type githubRepositories struct {
	Username     string             `json:"username"`
	Repositories []githubRepository `json:"repositories"`
}

type musicPreference struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	Genre       string `json:"genre"`
	Duration    string `json:"duration"`
	ReleaseDate string `json:"releaseDate"`
	CoverURL    string `json:"cover"`
	ExternalURL string `json:"href"`
}

type musicPreferenceStore interface {
	ListMusicPreferences(context.Context) ([]musicPreference, error)
	SaveMusicPreference(context.Context, musicPreference) (musicPreference, error)
	DeleteMusicPreference(context.Context, int64) error
}

type galleryCreation struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Model     string    `json:"model"`
	Prompt    string    `json:"prompt"`
	ImageURL  string    `json:"image"`
	CreatedAt time.Time `json:"createdAt"`
}

type galleryCreationStore interface {
	ListGalleryCreations(context.Context) ([]galleryCreation, error)
	SaveGalleryCreation(context.Context, galleryCreation) (galleryCreation, error)
	UpdateGalleryCreation(context.Context, galleryCreation) (galleryCreation, error)
	DeleteGalleryCreation(context.Context, int64) (galleryCreation, error)
}

type postgresGalleryCreationStore struct {
	pool *pgxpool.Pool
}

type noteRecord struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Date      string    `json:"date"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

type noteStore interface {
	ListNotes(context.Context) ([]noteRecord, error)
	SaveNote(context.Context, noteRecord) (noteRecord, error)
}

type postgresNoteStore struct {
	pool *pgxpool.Pool
}

type uploadedGalleryImage struct {
	URL string
	Key string
}

type galleryImageStorage interface {
	Upload(context.Context, string, string, []byte) (uploadedGalleryImage, error)
	Delete(context.Context, string) error
}

type galleryImageURLDeleter interface {
	DeleteURL(context.Context, string) error
}

var errGalleryStorageNotConfigured = errors.New("gallery image storage is not configured")
var errGalleryImageTooLarge = errors.New("gallery image exceeds 10 MB")
var errGalleryImageType = errors.New("unsupported gallery image type")
var errGalleryCreationNotFound = errors.New("gallery creation not found")

type postgresMusicPreferenceStore struct {
	pool *pgxpool.Pool
}

var errMusicPreferenceNotFound = errors.New("music preference not found")
var errInvalidMusicURL = errors.New("invalid supported music URL")

// Keep the old name for callers compiled against the original Apple-only importer.
var errInvalidAppleMusicURL = errInvalidMusicURL

type musicProvider string

const (
	musicProviderApple   musicProvider = "Apple Music"
	musicProviderQQ      musicProvider = "QQ Music"
	musicProviderNetEase musicProvider = "NetEase Cloud Music"
)

var musicHostProviders = map[string]musicProvider{
	"music.apple.com":   musicProviderApple,
	"y.qq.com":          musicProviderQQ,
	"c.y.qq.com":        musicProviderQQ,
	"i.y.qq.com":        musicProviderQQ,
	"i2.y.qq.com":       musicProviderQQ,
	"music.163.com":     musicProviderNetEase,
	"www.music.163.com": musicProviderNetEase,
}

func (store postgresMusicPreferenceStore) ListMusicPreferences(ctx context.Context) ([]musicPreference, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT id, title, artist, album, genre, duration, release_date, cover_url, external_url
		FROM music_preferences
		ORDER BY created_at DESC, id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list music preferences: %w", err)
	}
	defer rows.Close()

	preferences := make([]musicPreference, 0)
	for rows.Next() {
		var preference musicPreference
		if err := rows.Scan(
			&preference.ID,
			&preference.Title,
			&preference.Artist,
			&preference.Album,
			&preference.Genre,
			&preference.Duration,
			&preference.ReleaseDate,
			&preference.CoverURL,
			&preference.ExternalURL,
		); err != nil {
			return nil, fmt.Errorf("scan music preference: %w", err)
		}
		preferences = append(preferences, preference)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate music preferences: %w", err)
	}
	return preferences, nil
}

func (store postgresMusicPreferenceStore) SaveMusicPreference(ctx context.Context, preference musicPreference) (musicPreference, error) {
	err := store.pool.QueryRow(ctx, `
		INSERT INTO music_preferences (title, artist, album, genre, duration, release_date, cover_url, external_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (external_url) DO UPDATE SET
			title = EXCLUDED.title,
			artist = EXCLUDED.artist,
			album = EXCLUDED.album,
			genre = EXCLUDED.genre,
			duration = EXCLUDED.duration,
			release_date = EXCLUDED.release_date,
			cover_url = EXCLUDED.cover_url
		RETURNING id, title, artist, album, genre, duration, release_date, cover_url, external_url
	`, preference.Title, preference.Artist, preference.Album, preference.Genre, preference.Duration, preference.ReleaseDate, preference.CoverURL, preference.ExternalURL).Scan(
		&preference.ID,
		&preference.Title,
		&preference.Artist,
		&preference.Album,
		&preference.Genre,
		&preference.Duration,
		&preference.ReleaseDate,
		&preference.CoverURL,
		&preference.ExternalURL,
	)
	if err != nil {
		return musicPreference{}, fmt.Errorf("save music preference: %w", err)
	}
	return preference, nil
}

func (store postgresMusicPreferenceStore) DeleteMusicPreference(ctx context.Context, id int64) error {
	commandTag, err := store.pool.Exec(ctx, `DELETE FROM music_preferences WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete music preference: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return errMusicPreferenceNotFound
	}
	return nil
}

func (store postgresGalleryCreationStore) ListGalleryCreations(ctx context.Context) ([]galleryCreation, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT id, title, model, prompt, image_url, created_at
		FROM gallery_creations
		ORDER BY created_at DESC, id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list gallery creations: %w", err)
	}
	defer rows.Close()

	creations := make([]galleryCreation, 0)
	for rows.Next() {
		var creation galleryCreation
		if err := rows.Scan(&creation.ID, &creation.Title, &creation.Model, &creation.Prompt, &creation.ImageURL, &creation.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan gallery creation: %w", err)
		}
		creations = append(creations, creation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gallery creations: %w", err)
	}
	return creations, nil
}

func (store postgresGalleryCreationStore) SaveGalleryCreation(ctx context.Context, creation galleryCreation) (galleryCreation, error) {
	err := store.pool.QueryRow(ctx, `
		INSERT INTO gallery_creations (title, model, prompt, image_url)
		VALUES ($1, $2, $3, $4)
		RETURNING id, title, model, prompt, image_url, created_at
	`, creation.Title, creation.Model, creation.Prompt, creation.ImageURL).Scan(
		&creation.ID,
		&creation.Title,
		&creation.Model,
		&creation.Prompt,
		&creation.ImageURL,
		&creation.CreatedAt,
	)
	if err != nil {
		return galleryCreation{}, fmt.Errorf("save gallery creation: %w", err)
	}
	return creation, nil
}

func (store postgresGalleryCreationStore) UpdateGalleryCreation(ctx context.Context, creation galleryCreation) (galleryCreation, error) {
	err := store.pool.QueryRow(ctx, `
		UPDATE gallery_creations
		SET title = $1, model = $2, prompt = $3, image_url = $4
		WHERE id = $5
		RETURNING id, title, model, prompt, image_url, created_at
	`, creation.Title, creation.Model, creation.Prompt, creation.ImageURL, creation.ID).Scan(
		&creation.ID,
		&creation.Title,
		&creation.Model,
		&creation.Prompt,
		&creation.ImageURL,
		&creation.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return galleryCreation{}, errGalleryCreationNotFound
	}
	if err != nil {
		return galleryCreation{}, fmt.Errorf("update gallery creation: %w", err)
	}
	return creation, nil
}

func (store postgresGalleryCreationStore) DeleteGalleryCreation(ctx context.Context, id int64) (galleryCreation, error) {
	var creation galleryCreation
	err := store.pool.QueryRow(ctx, `
		DELETE FROM gallery_creations
		WHERE id = $1
		RETURNING id, title, model, prompt, image_url, created_at
	`, id).Scan(&creation.ID, &creation.Title, &creation.Model, &creation.Prompt, &creation.ImageURL, &creation.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return galleryCreation{}, errGalleryCreationNotFound
	}
	if err != nil {
		return galleryCreation{}, fmt.Errorf("delete gallery creation: %w", err)
	}
	return creation, nil
}

func (store postgresNoteStore) ListNotes(ctx context.Context) ([]noteRecord, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT id, title, note_date::TEXT, content_markdown, created_at
		FROM notes
		ORDER BY note_date DESC, id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	notes := make([]noteRecord, 0)
	for rows.Next() {
		var note noteRecord
		if err := rows.Scan(&note.ID, &note.Title, &note.Date, &note.Content, &note.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan note: %w", err)
		}
		notes = append(notes, note)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notes: %w", err)
	}
	return notes, nil
}

func (store postgresNoteStore) SaveNote(ctx context.Context, note noteRecord) (noteRecord, error) {
	err := store.pool.QueryRow(ctx, `
		INSERT INTO notes (title, note_date, content_markdown)
		VALUES ($1, $2::DATE, $3)
		RETURNING id, title, note_date::TEXT, content_markdown, created_at
	`, note.Title, note.Date, note.Content).Scan(
		&note.ID,
		&note.Title,
		&note.Date,
		&note.Content,
		&note.CreatedAt,
	)
	if err != nil {
		return noteRecord{}, fmt.Errorf("save note: %w", err)
	}
	return note, nil
}

type ossGalleryImageStorage struct {
	bucket        *oss.Bucket
	bucketName    string
	endpoint      string
	publicBaseURL string
}

func newOSSGalleryImageStorage() (galleryImageStorage, error) {
	endpoint := strings.TrimSpace(os.Getenv("OSS_ENDPOINT"))
	bucketName := strings.TrimSpace(os.Getenv("OSS_BUCKET"))
	accessKeyID := strings.TrimSpace(os.Getenv("OSS_ACCESS_KEY_ID"))
	accessKeySecret := strings.TrimSpace(os.Getenv("OSS_ACCESS_KEY_SECRET"))
	if endpoint == "" || bucketName == "" || accessKeyID == "" || accessKeySecret == "" {
		return nil, errGalleryStorageNotConfigured
	}
	endpoint = strings.TrimRight(strings.TrimPrefix(strings.TrimPrefix(endpoint, "https://"), "http://"), "/")
	client, err := oss.New(endpoint, accessKeyID, accessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("create OSS client: %w", err)
	}
	bucket, err := client.Bucket(bucketName)
	if err != nil {
		return nil, fmt.Errorf("open OSS bucket: %w", err)
	}
	return &ossGalleryImageStorage{
		bucket:        bucket,
		bucketName:    bucketName,
		endpoint:      endpoint,
		publicBaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("OSS_PUBLIC_BASE_URL")), "/"),
	}, nil
}

func (storage *ossGalleryImageStorage) Upload(_ context.Context, extension string, contentType string, data []byte) (uploadedGalleryImage, error) {
	randomBytes := make([]byte, 8)
	if _, err := cryptorand.Read(randomBytes); err != nil {
		return uploadedGalleryImage{}, fmt.Errorf("generate gallery image key: %w", err)
	}
	key := path.Join("gallery", time.Now().UTC().Format("2006/01"), fmt.Sprintf("%d-%x%s", time.Now().UTC().UnixNano(), randomBytes, extension))
	if err := storage.bucket.PutObject(key, bytes.NewReader(data), oss.ContentType(contentType)); err != nil {
		return uploadedGalleryImage{}, fmt.Errorf("upload gallery image to OSS: %w", err)
	}
	return uploadedGalleryImage{URL: storage.objectURL(key), Key: key}, nil
}

func (storage *ossGalleryImageStorage) Delete(_ context.Context, key string) error {
	if strings.TrimSpace(key) == "" {
		return nil
	}
	return storage.bucket.DeleteObject(key)
}

func (storage *ossGalleryImageStorage) DeleteURL(ctx context.Context, rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" {
		return nil
	}
	key := strings.TrimPrefix(parsed.Path, "/")
	if !strings.HasPrefix(key, "gallery/") {
		return nil
	}
	key, err = url.PathUnescape(key)
	if err != nil {
		return nil
	}
	return storage.Delete(ctx, key)
}

func (storage *ossGalleryImageStorage) objectURL(key string) string {
	if storage.publicBaseURL != "" {
		return storage.publicBaseURL + "/" + key
	}
	return "https://" + storage.bucketName + "." + storage.endpoint + "/" + key
}

type githubProfile struct {
	Username        string `json:"username"`
	RepositoryCount int    `json:"repositoryCount"`
	Stars           int    `json:"stars"`
	Forks           int    `json:"forks"`
	Followers       int    `json:"followers"`
}

type githubOverview struct {
	Profile       githubProfile       `json:"profile"`
	Repositories  []githubRepository  `json:"repositories"`
	Contributions githubContributions `json:"contributions"`
}

type githubOverviewResponse struct {
	Profile       githubProfile       `json:"profile"`
	Repositories  []githubRepository  `json:"repositories"`
	Contributions githubContributions `json:"contributions"`
	RefreshedAt   time.Time           `json:"refreshedAt"`
}

type githubOverviewStore interface {
	LoadGitHubOverview(context.Context) (githubOverview, time.Time, error)
	SaveGitHubOverview(context.Context, githubOverview) (time.Time, error)
}

type postgresGitHubOverviewStore struct {
	pool *pgxpool.Pool
}

var errGitHubOverviewNotFound = errors.New("GitHub overview snapshot not found")

func (store postgresGitHubOverviewStore) LoadGitHubOverview(ctx context.Context) (githubOverview, time.Time, error) {
	var payload []byte
	var refreshedAt time.Time
	err := store.pool.QueryRow(ctx, `SELECT payload, refreshed_at FROM github_overview_snapshots WHERE id = 1`).Scan(&payload, &refreshedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return githubOverview{}, time.Time{}, errGitHubOverviewNotFound
	}
	if err != nil {
		return githubOverview{}, time.Time{}, fmt.Errorf("load GitHub overview snapshot: %w", err)
	}

	var overview githubOverview
	if err := json.Unmarshal(payload, &overview); err != nil {
		return githubOverview{}, time.Time{}, fmt.Errorf("decode GitHub overview snapshot: %w", err)
	}
	return overview, refreshedAt, nil
}

func (store postgresGitHubOverviewStore) SaveGitHubOverview(ctx context.Context, overview githubOverview) (time.Time, error) {
	payload, err := json.Marshal(overview)
	if err != nil {
		return time.Time{}, fmt.Errorf("encode GitHub overview snapshot: %w", err)
	}

	var refreshedAt time.Time
	err = store.pool.QueryRow(ctx, `
		INSERT INTO github_overview_snapshots (id, payload, refreshed_at)
		VALUES (1, $1::jsonb, NOW())
		ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = NOW()
		RETURNING refreshed_at
	`, string(payload)).Scan(&refreshedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("save GitHub overview snapshot: %w", err)
	}
	return refreshedAt, nil
}

func githubOverviewResponseFrom(overview githubOverview, refreshedAt time.Time) githubOverviewResponse {
	return githubOverviewResponse{
		Profile:       overview.Profile,
		Repositories:  overview.Repositories,
		Contributions: overview.Contributions,
		RefreshedAt:   refreshedAt,
	}
}

type steamProfile struct {
	SteamID      string `json:"steamId"`
	Name         string `json:"name"`
	ProfileURL   string `json:"profileUrl"`
	AvatarURL    string `json:"avatarUrl"`
	PersonaState int    `json:"personaState"`
}

type steamGame struct {
	AppID           int    `json:"appId"`
	Name            string `json:"name"`
	PlaytimeForever int    `json:"playtimeForever"`
	Playtime2Weeks  int    `json:"playtime2Weeks"`
}

type steamAPIGame struct {
	AppID           int    `json:"appid"`
	Name            string `json:"name"`
	PlaytimeForever int    `json:"playtime_forever"`
	Playtime2Weeks  int    `json:"playtime_2weeks"`
}

type steamOverview struct {
	Profile        steamProfile `json:"profile"`
	GameCount      int          `json:"gameCount"`
	TotalPlaytime  int          `json:"totalPlaytime"`
	Games          []steamGame  `json:"games"`
	RecentlyPlayed []steamGame  `json:"recentlyPlayed"`
}

type steamOverviewResponse struct {
	Profile        steamProfile `json:"profile"`
	GameCount      int          `json:"gameCount"`
	TotalPlaytime  int          `json:"totalPlaytime"`
	Games          []steamGame  `json:"games"`
	RecentlyPlayed []steamGame  `json:"recentlyPlayed"`
	RefreshedAt    time.Time    `json:"refreshedAt"`
}

type steamOverviewStore interface {
	LoadSteamOverview(context.Context) (steamOverview, time.Time, error)
	SaveSteamOverview(context.Context, steamOverview) (time.Time, error)
}

type postgresSteamOverviewStore struct {
	pool *pgxpool.Pool
}

var errSteamOverviewNotFound = errors.New("Steam overview snapshot not found")

func (store postgresSteamOverviewStore) LoadSteamOverview(ctx context.Context) (steamOverview, time.Time, error) {
	var payload []byte
	var refreshedAt time.Time
	err := store.pool.QueryRow(ctx, `SELECT payload, refreshed_at FROM steam_overview_snapshots WHERE id = 1`).Scan(&payload, &refreshedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return steamOverview{}, time.Time{}, errSteamOverviewNotFound
	}
	if err != nil {
		return steamOverview{}, time.Time{}, fmt.Errorf("load Steam overview snapshot: %w", err)
	}

	var overview steamOverview
	if err := json.Unmarshal(payload, &overview); err != nil {
		return steamOverview{}, time.Time{}, fmt.Errorf("decode Steam overview snapshot: %w", err)
	}
	return overview, refreshedAt, nil
}

func (store postgresSteamOverviewStore) SaveSteamOverview(ctx context.Context, overview steamOverview) (time.Time, error) {
	payload, err := json.Marshal(overview)
	if err != nil {
		return time.Time{}, fmt.Errorf("encode Steam overview snapshot: %w", err)
	}

	var refreshedAt time.Time
	err = store.pool.QueryRow(ctx, `
		INSERT INTO steam_overview_snapshots (id, payload, refreshed_at)
		VALUES (1, $1::jsonb, NOW())
		ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = NOW()
		RETURNING refreshed_at
	`, string(payload)).Scan(&refreshedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("save Steam overview snapshot: %w", err)
	}
	return refreshedAt, nil
}

func steamOverviewResponseFrom(overview steamOverview, refreshedAt time.Time) steamOverviewResponse {
	return steamOverviewResponse{
		Profile:        overview.Profile,
		GameCount:      overview.GameCount,
		TotalPlaytime:  overview.TotalPlaytime,
		Games:          overview.Games,
		RecentlyPlayed: overview.RecentlyPlayed,
		RefreshedAt:    refreshedAt,
	}
}

func main() {
	loadLocalEnvironment()
	databaseURL := envOrDefault(
		"DATABASE_URL",
		"postgres://blog:blog_dev_password@localhost:55432/blog?sslmode=disable",
	)
	port := envOrDefault("BACKEND_PORT", "8090")
	githubUsername := envOrDefault("GITHUB_USERNAME", "CbhHikari0828")
	steamAPIKey := strings.TrimSpace(os.Getenv("STEAM_WEB_API_KEY"))
	steamID := strings.TrimSpace(os.Getenv("STEAM_ID"))

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		log.Fatalf("create database pool: %v", err)
	}
	defer pool.Close()

	pingContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingContext); err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	if err := ensureOverviewSnapshotTables(context.Background(), pool); err != nil {
		log.Fatalf("ensure overview snapshot tables: %v", err)
	}
	if err := ensureMusicPreferencesTable(context.Background(), pool); err != nil {
		log.Fatalf("ensure music preferences table: %v", err)
	}
	if err := ensureGalleryCreationsTable(context.Background(), pool); err != nil {
		log.Fatalf("ensure gallery creations table: %v", err)
	}
	if err := ensureNotesTable(context.Background(), pool); err != nil {
		log.Fatalf("ensure notes table: %v", err)
	}
	galleryStorage, storageErr := newOSSGalleryImageStorage()
	if storageErr != nil && !errors.Is(storageErr, errGalleryStorageNotConfigured) {
		log.Printf("gallery image storage unavailable: %v", storageErr)
	}

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	router.GET("/api/health", healthHandler(pool))
	githubClient := &http.Client{Timeout: 10 * time.Second}
	githubStore := postgresGitHubOverviewStore{pool: pool}
	router.GET("/api/github/contributions", githubContributionsSnapshotHandler(githubStore))
	router.GET("/api/github/repositories", githubRepositoriesSnapshotHandler(githubStore))
	router.GET("/api/github/profile", githubProfileSnapshotHandler(githubStore))
	router.POST("/api/admin/github/refresh", githubRefreshHandler(githubClient, githubUsername, githubStore))
	steamStore := postgresSteamOverviewStore{pool: pool}
	router.GET("/api/steam/overview", steamOverviewHandler(steamStore))
	router.POST("/api/admin/steam/refresh", steamRefreshHandler(githubClient, steamAPIKey, steamID, steamStore))
	musicStore := postgresMusicPreferenceStore{pool: pool}
	musicClient := newMusicClient()
	router.GET("/api/music", musicPreferencesHandler(musicStore))
	router.POST("/api/admin/music/import", musicImportHandler(musicClient, musicStore))
	router.DELETE("/api/admin/music/:id", musicDeleteHandler(musicStore))
	galleryStore := postgresGalleryCreationStore{pool: pool}
	router.GET("/api/gallery", galleryCreationsHandler(galleryStore))
	router.POST("/api/admin/gallery", galleryCreationImportHandler(galleryStorage, galleryStore))
	router.PUT("/api/admin/gallery/:id", galleryCreationUpdateHandler(galleryStorage, galleryStore))
	router.DELETE("/api/admin/gallery/:id", galleryCreationDeleteHandler(galleryStorage, galleryStore))
	noteStore := postgresNoteStore{pool: pool}
	router.GET("/api/notes", notesHandler(noteStore))
	router.POST("/api/admin/notes", noteCreateHandler(noteStore))

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("backend listening on http://localhost:%s", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve HTTP: %v", err)
	}
}

func githubSnapshotError(c *gin.Context, err error) bool {
	if errors.Is(err, errGitHubOverviewNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "GitHub data has not been refreshed yet"})
		return true
	}
	if err != nil {
		log.Printf("load GitHub overview snapshot: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "GitHub data is temporarily unavailable"})
		return true
	}
	return false
}

func githubContributionsSnapshotHandler(store githubOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		overview, _, err := store.LoadGitHubOverview(c.Request.Context())
		if githubSnapshotError(c, err) {
			return
		}
		c.JSON(http.StatusOK, overview.Contributions)
	}
}

func githubRepositoriesSnapshotHandler(store githubOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		overview, _, err := store.LoadGitHubOverview(c.Request.Context())
		if githubSnapshotError(c, err) {
			return
		}

		limit := 3
		if requestedLimit := c.Query("limit"); requestedLimit != "" {
			parsedLimit, parseErr := strconv.Atoi(requestedLimit)
			if parseErr != nil || parsedLimit < 1 || parsedLimit > 100 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 100"})
				return
			}
			limit = parsedLimit
		}
		if limit < len(overview.Repositories) {
			overview.Repositories = overview.Repositories[:limit]
		}
		c.JSON(http.StatusOK, githubRepositories{Username: overview.Profile.Username, Repositories: overview.Repositories})
	}
}

func githubProfileSnapshotHandler(store githubOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		overview, _, err := store.LoadGitHubOverview(c.Request.Context())
		if githubSnapshotError(c, err) {
			return
		}
		c.JSON(http.StatusOK, overview.Profile)
	}
}

func githubRefreshHandler(client *http.Client, username string, store githubOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		overview, err := fetchGitHubOverview(c.Request.Context(), client, username, time.Now().Year())
		if err != nil {
			log.Printf("refresh GitHub overview for %s: %v", username, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub data is temporarily unavailable"})
			return
		}

		refreshedAt, err := store.SaveGitHubOverview(c.Request.Context(), overview)
		if err != nil {
			log.Printf("save GitHub overview snapshot: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "GitHub data could not be saved"})
			return
		}
		c.JSON(http.StatusOK, githubOverviewResponseFrom(overview, refreshedAt))
	}
}

func ensureOverviewSnapshotTables(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS steam_overview_snapshots (
			id SMALLINT PRIMARY KEY CHECK (id = 1),
			payload JSONB NOT NULL,
			refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS github_overview_snapshots (
			id SMALLINT PRIMARY KEY CHECK (id = 1),
			payload JSONB NOT NULL,
			refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func ensureMusicPreferencesTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
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
		)
	`)
	return err
}

func ensureGalleryCreationsTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS gallery_creations (
			id BIGSERIAL PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT NOT NULL DEFAULT '',
			prompt TEXT NOT NULL DEFAULT '',
			image_url TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func ensureNotesTable(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS notes (
			id BIGSERIAL PRIMARY KEY,
			title TEXT NOT NULL,
			note_date DATE NOT NULL,
			content_markdown TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS notes_note_date_idx
		ON notes (note_date DESC, id DESC)
	`)
	return err
}

func newMusicClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			if _, ok := musicProviderForURL(request.URL); !ok {
				return errInvalidMusicURL
			}
			return nil
		},
	}
}

func newAppleMusicClient() *http.Client {
	return newMusicClient()
}

func musicProviderForURL(value *url.URL) (musicProvider, bool) {
	if value == nil || value.Scheme != "https" || value.User != nil {
		return "", false
	}
	if value.Port() != "" && value.Port() != "443" {
		return "", false
	}
	provider, ok := musicHostProviders[strings.TrimSuffix(strings.ToLower(value.Hostname()), ".")]
	return provider, ok
}

func isAppleMusicURL(value *url.URL) bool {
	provider, ok := musicProviderForURL(value)
	return ok && provider == musicProviderApple
}

func validateMusicURL(rawURL string) (*url.URL, musicProvider, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Path == "" {
		return nil, "", errInvalidMusicURL
	}
	provider, ok := musicProviderForURL(parsed)
	if !ok {
		return nil, "", errInvalidMusicURL
	}
	return parsed, provider, nil
}

func validateAppleMusicURL(rawURL string) (*url.URL, error) {
	parsed, provider, err := validateMusicURL(rawURL)
	if err != nil || provider != musicProviderApple {
		return nil, errInvalidMusicURL
	}
	return parsed, nil
}

func normalizeMusicPageURL(pageURL *url.URL, provider musicProvider) *url.URL {
	if pageURL == nil {
		return pageURL
	}
	if provider == musicProviderQQ && strings.EqualFold(pageURL.Hostname(), "y.qq.com") {
		pathSegments := strings.Split(strings.Trim(pageURL.Path, "/"), "/")
		for index, segment := range pathSegments {
			if strings.EqualFold(segment, "songDetail") && index+1 < len(pathSegments) && pathSegments[index+1] != "" {
				return &url.URL{Scheme: "https", Host: "i.y.qq.com", Path: "/v8/playsong.html", RawQuery: url.Values{"songmid": []string{pathSegments[index+1]}}.Encode()}
			}
		}
	}
	if provider != musicProviderNetEase || !strings.HasPrefix(pageURL.Fragment, "/") {
		return pageURL
	}
	fragmentURL, err := url.Parse(pageURL.Fragment)
	if err != nil || fragmentURL.Path == "" {
		return pageURL
	}
	normalized := *pageURL
	normalized.Path = fragmentURL.Path
	normalized.RawPath = fragmentURL.RawPath
	normalized.RawQuery = fragmentURL.RawQuery
	normalized.Fragment = ""
	return &normalized
}

type appleMusicJSONLD struct {
	Name          string          `json:"name"`
	URL           string          `json:"url"`
	DatePublished string          `json:"datePublished"`
	TimeRequired  string          `json:"timeRequired"`
	Image         string          `json:"image"`
	Genre         json.RawMessage `json:"genre"`
	Audio         struct {
		Name     string `json:"name"`
		Duration string `json:"duration"`
		Image    string `json:"image"`
		ByArtist []struct {
			Name string `json:"name"`
		} `json:"byArtist"`
		InAlbum struct {
			Name     string `json:"name"`
			Image    string `json:"image"`
			ByArtist []struct {
				Name string `json:"name"`
			} `json:"byArtist"`
		} `json:"inAlbum"`
	} `json:"audio"`
}

func fetchAppleMusicPreference(ctx context.Context, client *http.Client, rawURL string) (musicPreference, error) {
	pageURL, err := validateAppleMusicURL(rawURL)
	if err != nil {
		return musicPreference{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL.String(), nil)
	if err != nil {
		return musicPreference{}, fmt.Errorf("create Apple Music request: %w", err)
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("User-Agent", "NextAlexBlog/1.0")
	response, err := client.Do(request)
	if err != nil {
		return musicPreference{}, fmt.Errorf("request Apple Music page: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return musicPreference{}, fmt.Errorf("Apple Music returned %s", response.Status)
	}

	document, err := html.Parse(io.LimitReader(response.Body, 3<<20))
	if err != nil {
		return musicPreference{}, fmt.Errorf("parse Apple Music page: %w", err)
	}
	metadata := make(map[string]string)
	var schemaData string
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			attributes := htmlAttributes(node)
			switch node.Data {
			case "meta":
				key := strings.ToLower(attributes["property"])
				if key == "" {
					key = strings.ToLower(attributes["name"])
				}
				if key != "" && attributes["content"] != "" {
					metadata[key] = strings.TrimSpace(attributes["content"])
				}
			case "script":
				if attributes["id"] == "schema:song" || strings.EqualFold(attributes["type"], "application/ld+json") {
					candidate := strings.TrimSpace(htmlText(node))
					if strings.Contains(candidate, `"@type":"MusicComposition"`) || strings.Contains(candidate, `"@type": "MusicComposition"`) {
						schemaData = candidate
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)

	var schema appleMusicJSONLD
	if schemaData != "" {
		if err := json.Unmarshal([]byte(schemaData), &schema); err != nil {
			return musicPreference{}, fmt.Errorf("decode Apple Music metadata: %w", err)
		}
	}
	title := firstNonEmpty(schema.Name, metadata["apple:title"])
	artist := ""
	if len(schema.Audio.ByArtist) > 0 {
		artist = schema.Audio.ByArtist[0].Name
	}
	if artist == "" && len(schema.Audio.InAlbum.ByArtist) > 0 {
		artist = schema.Audio.InAlbum.ByArtist[0].Name
	}
	album := schema.Audio.InAlbum.Name
	cover := firstNonEmpty(schema.Audio.InAlbum.Image, schema.Audio.Image, schema.Image, metadata["og:image"], metadata["twitter:image"])
	externalURL := firstNonEmpty(schema.URL, metadata["music:song"], pageURL.String())
	duration := formatAppleMusicDuration(firstNonEmpty(schema.TimeRequired, schema.Audio.Duration))
	if title == "" || artist == "" || cover == "" {
		return musicPreference{}, errors.New("Apple Music page did not contain complete song metadata")
	}
	return musicPreference{
		Title:       title,
		Artist:      artist,
		Album:       album,
		Genre:       firstAppleMusicGenre(schema.Genre),
		Duration:    duration,
		ReleaseDate: strings.Split(firstNonEmpty(schema.DatePublished, metadata["music:release_date"]), "T")[0],
		CoverURL:    cover,
		ExternalURL: externalURL,
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstAppleMusicGenre(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var genres []string
	if json.Unmarshal(raw, &genres) == nil {
		for _, genre := range genres {
			if strings.TrimSpace(genre) != "" && !strings.EqualFold(genre, "music") && genre != "音乐" {
				return strings.TrimSpace(genre)
			}
		}
	}
	var genre string
	if json.Unmarshal(raw, &genre) == nil {
		return strings.TrimSpace(genre)
	}
	return ""
}

func formatAppleMusicDuration(raw string) string {
	match := isoDurationPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if len(match) == 0 {
		return strings.TrimSpace(raw)
	}
	hours, minutes, seconds := 0, 0, 0
	if match[1] != "" {
		hours, _ = strconv.Atoi(match[1])
	}
	if match[2] != "" {
		minutes, _ = strconv.Atoi(match[2])
	}
	if match[3] != "" {
		seconds, _ = strconv.Atoi(match[3])
	}
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d", hours, minutes, seconds)
	}
	return fmt.Sprintf("%d:%02d", minutes, seconds)
}

type musicHTMLDocument struct {
	Metadata  map[string]string
	PageTitle string
	Scripts   []string
	JSONLD    []string
}

type musicMetadata struct {
	Title       string
	Artist      string
	Album       string
	Genre       string
	Duration    string
	ReleaseDate string
	CoverURL    string
	ExternalURL string
}

func parseMusicHTML(body io.Reader) (musicHTMLDocument, error) {
	document, err := html.Parse(io.LimitReader(body, 3<<20))
	if err != nil {
		return musicHTMLDocument{}, err
	}
	parsed := musicHTMLDocument{Metadata: make(map[string]string)}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			attributes := htmlAttributes(node)
			switch node.Data {
			case "meta":
				key := strings.ToLower(firstNonEmpty(attributes["property"], attributes["name"], attributes["itemprop"]))
				if key != "" && attributes["content"] != "" {
					parsed.Metadata[key] = strings.TrimSpace(attributes["content"])
				}
			case "title":
				parsed.PageTitle = strings.TrimSpace(htmlText(node))
			case "script":
				script := strings.TrimSpace(htmlText(node))
				if script != "" {
					parsed.Scripts = append(parsed.Scripts, script)
				}
				if strings.EqualFold(attributes["type"], "application/ld+json") {
					if script != "" {
						parsed.JSONLD = append(parsed.JSONLD, script)
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	return parsed, nil
}

func fetchMusicPreference(ctx context.Context, client *http.Client, rawURL string) (musicPreference, error) {
	pageURL, provider, err := validateMusicURL(rawURL)
	if err != nil {
		return musicPreference{}, err
	}
	externalURL := pageURL.String()
	pageURL = normalizeMusicPageURL(pageURL, provider)
	if provider == musicProviderApple {
		return fetchAppleMusicPreference(ctx, client, pageURL.String())
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL.String(), nil)
	if err != nil {
		return musicPreference{}, fmt.Errorf("create %s request: %w", provider, err)
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
	response, err := client.Do(request)
	if err != nil {
		return musicPreference{}, fmt.Errorf("request %s page: %w", provider, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return musicPreference{}, fmt.Errorf("%s returned %s", provider, response.Status)
	}

	document, err := parseMusicHTML(response.Body)
	if err != nil {
		return musicPreference{}, fmt.Errorf("parse %s page: %w", provider, err)
	}
	metadata := musicMetadataFromDocument(document, pageURL)
	if metadata.Title == "" || metadata.Artist == "" || metadata.CoverURL == "" {
		return musicPreference{}, fmt.Errorf("%s page did not contain complete song metadata", provider)
	}
	if provider == musicProviderQQ {
		metadata.ExternalURL = externalURL
	}
	return musicPreference{
		Title:       metadata.Title,
		Artist:      metadata.Artist,
		Album:       metadata.Album,
		Genre:       metadata.Genre,
		Duration:    metadata.Duration,
		ReleaseDate: metadata.ReleaseDate,
		CoverURL:    metadata.CoverURL,
		ExternalURL: metadata.ExternalURL,
	}, nil
}

func musicMetadataFromDocument(document musicHTMLDocument, pageURL *url.URL) musicMetadata {
	var metadata musicMetadata
	for _, raw := range document.JSONLD {
		mergeMusicMetadata(&metadata, parseMusicJSONLD(raw))
	}
	for _, script := range document.Scripts {
		mergeMusicMetadata(&metadata, parseMusicScript(script))
	}
	metadata.Title = firstNonEmpty(metadata.Title,
		document.Metadata["music:title"], document.Metadata["og:title"],
		document.Metadata["twitter:title"], document.Metadata["title"], document.PageTitle)
	metadata.Artist = firstNonEmpty(metadata.Artist,
		document.Metadata["music:musician"], document.Metadata["music:artist"],
		document.Metadata["og:artist"], document.Metadata["artist"], document.Metadata["author"])
	metadata.Album = firstNonEmpty(metadata.Album, document.Metadata["music:album"], document.Metadata["album"])
	metadata.Genre = firstNonEmpty(metadata.Genre, document.Metadata["music:genre"], document.Metadata["genre"])
	metadata.Duration = formatAppleMusicDuration(firstNonEmpty(metadata.Duration, document.Metadata["music:duration"], document.Metadata["duration"]))
	metadata.ReleaseDate = strings.Split(firstNonEmpty(metadata.ReleaseDate, document.Metadata["music:release_date"], document.Metadata["release_date"], document.Metadata["date"]), "T")[0]
	metadata.CoverURL = firstNonEmpty(metadata.CoverURL, document.Metadata["og:image"], document.Metadata["twitter:image"], document.Metadata["image"])
	metadata.Title = cleanMusicTitle(metadata.Title)
	description := firstNonEmpty(document.Metadata["description"], document.Metadata["og:description"])
	if metadata.Artist == "" {
		metadata.Artist = artistFromText(description)
	}
	if metadata.Album == "" {
		metadata.Album = albumFromText(description)
	}
	metadata.CoverURL = resolveMusicAssetURL(metadata.CoverURL, pageURL)
	canonical := firstNonEmpty(metadata.ExternalURL, document.Metadata["og:url"])
	metadata.ExternalURL = pageURL.String()
	if canonical != "" {
		if candidate, provider, err := validateMusicURL(canonical); err == nil {
			if pageProvider, ok := musicProviderForURL(pageURL); ok && provider == pageProvider {
				metadata.ExternalURL = candidate.String()
			}
		}
	}
	return metadata
}

func mergeMusicMetadata(target *musicMetadata, source musicMetadata) {
	if target.Title == "" {
		target.Title = source.Title
	}
	if target.Artist == "" {
		target.Artist = source.Artist
	}
	if target.Album == "" {
		target.Album = source.Album
	}
	if target.Genre == "" {
		target.Genre = source.Genre
	}
	if target.Duration == "" {
		target.Duration = source.Duration
	}
	if target.ReleaseDate == "" {
		target.ReleaseDate = source.ReleaseDate
	}
	if target.CoverURL == "" {
		target.CoverURL = source.CoverURL
	}
	if target.ExternalURL == "" {
		target.ExternalURL = source.ExternalURL
	}
}

func parseMusicJSONLD(raw string) musicMetadata {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return musicMetadata{}
	}
	var result musicMetadata
	var walk func(any)
	walk = func(current any) {
		object, ok := current.(map[string]any)
		if !ok {
			if values, ok := current.([]any); ok {
				for _, value := range values {
					walk(value)
				}
			}
			return
		}
		if isMusicJSONLDObject(object) {
			mergeMusicMetadata(&result, musicMetadataFromJSONLDObject(object))
		}
		for _, value := range object {
			walk(value)
		}
	}
	walk(value)
	return result
}

func isMusicJSONLDObject(object map[string]any) bool {
	typeName := strings.ToLower(jsonValueString(object["@type"]))
	return strings.Contains(typeName, "music") || object["byArtist"] != nil || object["inAlbum"] != nil || object["duration"] != nil
}

func musicMetadataFromJSONLDObject(object map[string]any) musicMetadata {
	return musicMetadata{
		Title:       jsonValueString(firstJSONValue(object, "name", "title")),
		Artist:      jsonValueString(firstJSONValue(object, "byArtist", "artist", "creator")),
		Album:       jsonValueString(firstJSONValue(object, "inAlbum", "album")),
		Genre:       jsonValueString(firstJSONValue(object, "genre")),
		Duration:    jsonValueString(firstJSONValue(object, "duration", "timeRequired")),
		ReleaseDate: jsonValueString(firstJSONValue(object, "datePublished", "dateCreated", "releaseDate")),
		CoverURL:    jsonValueString(firstJSONValue(object, "image", "thumbnailUrl")),
		ExternalURL: jsonValueString(firstJSONValue(object, "url")),
	}
}

func firstJSONValue(object map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := object[key]; ok {
			return value
		}
	}
	return nil
}

func jsonValueString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		for _, item := range typed {
			if result := jsonValueString(item); result != "" {
				return result
			}
		}
	case map[string]any:
		return firstNonEmpty(jsonValueString(typed["name"]), jsonValueString(typed["url"]), jsonValueString(typed["@id"]))
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	}
	return ""
}

var musicScriptFieldPattern = regexp.MustCompile(`(?i)["']?(songname|songName|songtitle|songTitle|singer|singername|artist|artistName|albumname|albumName|album|albumpic_big|albumPic|cover|coverUrl|pic|duration|genre|name|title)["']?\s*[:=]\s*["']([^"']+)["']`)

func parseMusicScript(script string) musicMetadata {
	metadata := parseQQMusicSSRScript(script)
	for _, match := range musicScriptFieldPattern.FindAllStringSubmatch(script, -1) {
		if len(match) != 3 {
			continue
		}
		value := strings.TrimSpace(match[2])
		switch strings.ToLower(match[1]) {
		case "songname", "songtitle", "name", "title":
			metadata.Title = firstNonEmpty(metadata.Title, value)
		case "singer", "singername", "artist", "artistname":
			metadata.Artist = firstNonEmpty(metadata.Artist, value)
		case "albumname", "album":
			metadata.Album = firstNonEmpty(metadata.Album, value)
		case "albumpic_big", "albumpic", "albumpicbig", "cover", "coverurl", "pic":
			metadata.CoverURL = firstNonEmpty(metadata.CoverURL, value)
		case "duration":
			metadata.Duration = firstNonEmpty(metadata.Duration, value)
		case "genre":
			metadata.Genre = firstNonEmpty(metadata.Genre, value)
		}
	}
	return metadata
}

func parseQQMusicSSRScript(script string) musicMetadata {
	payload := javascriptStringValue(script, "window.__ssrFirstPageData__")
	if payload == "" {
		return musicMetadata{}
	}
	var data struct {
		Song struct {
			Name       string `json:"name"`
			Title      string `json:"title"`
			Interval   int    `json:"interval"`
			TimePublic string `json:"time_public"`
			Img        string `json:"img"`
			Singer     []struct {
				Name  string `json:"name"`
				Title string `json:"title"`
			} `json:"singer"`
			Album struct {
				Name  string `json:"name"`
				Title string `json:"title"`
			} `json:"album"`
		} `json:"song"`
	}
	if json.Unmarshal([]byte(payload), &data) != nil || data.Song.Name == "" {
		return musicMetadata{}
	}
	artist := ""
	if len(data.Song.Singer) > 0 {
		artist = firstNonEmpty(data.Song.Singer[0].Name, data.Song.Singer[0].Title)
	}
	duration := ""
	if data.Song.Interval > 0 {
		duration = fmt.Sprintf("%d:%02d", data.Song.Interval/60, data.Song.Interval%60)
	}
	return musicMetadata{
		Title:       firstNonEmpty(data.Song.Name, data.Song.Title),
		Artist:      artist,
		Album:       firstNonEmpty(data.Song.Album.Name, data.Song.Album.Title),
		Duration:    duration,
		ReleaseDate: data.Song.TimePublic,
		CoverURL:    data.Song.Img,
	}
}

func javascriptStringValue(script, marker string) string {
	markerIndex := strings.Index(script, marker)
	if markerIndex < 0 {
		return ""
	}
	remainder := strings.TrimSpace(script[markerIndex+len(marker):])
	if !strings.HasPrefix(remainder, "=") {
		return ""
	}
	remainder = strings.TrimSpace(strings.TrimPrefix(remainder, "="))
	if !strings.HasPrefix(remainder, `"`) {
		return ""
	}
	escaped := false
	for index := 1; index < len(remainder); index++ {
		switch remainder[index] {
		case '\\':
			escaped = !escaped
		case '"':
			if !escaped {
				value, err := strconv.Unquote(remainder[:index+1])
				if err == nil {
					return value
				}
				return ""
			}
			escaped = false
		default:
			escaped = false
		}
	}
	return ""
}

func cleanMusicTitle(title string) string {
	title = strings.TrimSpace(title)
	for _, suffix := range []string{" - QQ音乐", " - 网易云音乐", " - NetEase Cloud Music", " - Apple Music"} {
		title = strings.TrimSuffix(title, suffix)
	}
	title = strings.TrimSpace(strings.TrimSuffix(title, " (歌曲)"))
	return title
}

func artistFromText(value string) string {
	for _, pattern := range []string{`(?i)(?:歌手|艺人|artist)\s*[：:]\s*([^|｜,，;；]+)`, `(?i)由\s*([^，,。]+?)\s*演唱`, `(?i)(?:by)\s+([^|｜,，;；]+)`} {
		match := regexp.MustCompile(pattern).FindStringSubmatch(value)
		if len(match) == 2 {
			return strings.TrimSpace(match[1])
		}
	}
	return ""
}

func albumFromText(value string) string {
	for _, pattern := range []string{`(?i)(?:专辑|album)\s*[：:]\s*([^|｜,，;；]+)`, `收录于《([^》]+)》`} {
		match := regexp.MustCompile(pattern).FindStringSubmatch(value)
		if len(match) == 2 {
			return strings.TrimSpace(match[1])
		}
	}
	return ""
}

func resolveMusicAssetURL(raw string, pageURL *url.URL) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.String() == "" {
		return ""
	}
	if !parsed.IsAbs() {
		parsed = pageURL.ResolveReference(parsed)
	}
	if parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return ""
	}
	if parsed.Scheme == "http" {
		parsed.Scheme = "https"
	}
	return parsed.String()
}

func musicPreferencesHandler(store musicPreferenceStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		preferences, err := store.ListMusicPreferences(c.Request.Context())
		if err != nil {
			log.Printf("load music preferences: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "music data is temporarily unavailable"})
			return
		}
		c.JSON(http.StatusOK, preferences)
	}
}

func musicImportHandler(client *http.Client, store musicPreferenceStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload struct {
			URL string `json:"url"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil || strings.TrimSpace(payload.URL) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "a supported music URL is required"})
			return
		}
		preference, err := fetchMusicPreference(c.Request.Context(), client, payload.URL)
		if errors.Is(err, errInvalidMusicURL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only HTTPS Apple Music, QQ Music, and NetEase Cloud Music URLs are supported"})
			return
		}
		if err != nil {
			log.Printf("import music metadata: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "music metadata could not be read"})
			return
		}
		saved, err := store.SaveMusicPreference(c.Request.Context(), preference)
		if err != nil {
			log.Printf("save music preference: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "music data could not be saved"})
			return
		}
		c.JSON(http.StatusOK, saved)
	}
}

func musicDeleteHandler(store musicPreferenceStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid music id"})
			return
		}
		if err := store.DeleteMusicPreference(c.Request.Context(), id); errors.Is(err, errMusicPreferenceNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "music preference not found"})
			return
		} else if err != nil {
			log.Printf("delete music preference: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "music data could not be deleted"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func galleryCreationsHandler(store galleryCreationStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		creations, err := store.ListGalleryCreations(c.Request.Context())
		if err != nil {
			log.Printf("load gallery creations: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gallery data is temporarily unavailable"})
			return
		}
		c.JSON(http.StatusOK, creations)
	}
}

func notesHandler(store noteStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		notes, err := store.ListNotes(c.Request.Context())
		if err != nil {
			log.Printf("load notes: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "notes are temporarily unavailable"})
			return
		}
		c.JSON(http.StatusOK, notes)
	}
}

func noteCreateHandler(store noteStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload struct {
			Title   string `json:"title"`
			Date    string `json:"date"`
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid note payload"})
			return
		}

		payload.Title = strings.TrimSpace(payload.Title)
		payload.Date = strings.TrimSpace(payload.Date)
		payload.Content = strings.TrimSpace(payload.Content)
		if payload.Title == "" || payload.Date == "" || payload.Content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "title, date, and content are required"})
			return
		}
		if _, err := time.Parse("2006-01-02", payload.Date); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date must use YYYY-MM-DD"})
			return
		}

		note, err := store.SaveNote(c.Request.Context(), noteRecord{
			Title:   payload.Title,
			Date:    payload.Date,
			Content: payload.Content,
		})
		if err != nil {
			log.Printf("save note: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "note could not be saved"})
			return
		}
		c.JSON(http.StatusCreated, note)
	}
}

func galleryCreationImportHandler(storage galleryImageStorage, store galleryCreationStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := parseGalleryMultipart(c); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid gallery upload"})
			return
		}
		title, model, prompt, imageURL := galleryFormValues(c)
		if title == "" || model == "" || prompt == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "title, model, and prompt are required"})
			return
		}

		var uploaded uploadedGalleryImage
		var err error
		uploaded, imageURL, err = uploadGalleryFormImage(c, storage, imageURL)
		if err != nil {
			respondGalleryImageError(c, err)
			return
		}
		if imageURL == "" || !isValidGalleryImageURL(imageURL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "an image upload or HTTPS image URL is required"})
			return
		}

		saved, err := store.SaveGalleryCreation(c.Request.Context(), galleryCreation{Title: title, Model: model, Prompt: prompt, ImageURL: imageURL})
		if err != nil {
			if uploaded.Key != "" && storage != nil {
				if deleteErr := storage.Delete(c.Request.Context(), uploaded.Key); deleteErr != nil {
					log.Printf("remove orphaned gallery image: %v", deleteErr)
				}
			}
			log.Printf("save gallery creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gallery data could not be saved"})
			return
		}
		c.JSON(http.StatusOK, saved)
	}
}

func galleryCreationUpdateHandler(storage galleryImageStorage, store galleryCreationStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid gallery id"})
			return
		}
		if err := parseGalleryMultipart(c); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid gallery upload"})
			return
		}
		title, model, prompt, imageURL := galleryFormValues(c)
		if title == "" || model == "" || prompt == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "title, model, and prompt are required"})
			return
		}

		current, err := findGalleryCreation(c.Request.Context(), store, id)
		if errors.Is(err, errGalleryCreationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "gallery creation not found"})
			return
		}
		if err != nil {
			log.Printf("load gallery creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gallery data could not be loaded"})
			return
		}

		if imageURL == "" {
			imageURL = current.ImageURL
		}
		var uploaded uploadedGalleryImage
		uploaded, imageURL, err = uploadGalleryFormImage(c, storage, imageURL)
		if err != nil {
			respondGalleryImageError(c, err)
			return
		}
		if imageURL == "" || !isValidGalleryImageURL(imageURL) {
			if uploaded.Key != "" {
				_ = storage.Delete(c.Request.Context(), uploaded.Key)
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "an image upload or HTTPS image URL is required"})
			return
		}

		updated, err := store.UpdateGalleryCreation(c.Request.Context(), galleryCreation{ID: id, Title: title, Model: model, Prompt: prompt, ImageURL: imageURL})
		if err != nil {
			if uploaded.Key != "" {
				if deleteErr := storage.Delete(c.Request.Context(), uploaded.Key); deleteErr != nil {
					log.Printf("remove orphaned gallery image: %v", deleteErr)
				}
			}
			if errors.Is(err, errGalleryCreationNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "gallery creation not found"})
				return
			}
			log.Printf("update gallery creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gallery data could not be saved"})
			return
		}

		if updated.ImageURL != current.ImageURL && storage != nil {
			if deleter, ok := storage.(galleryImageURLDeleter); ok {
				if deleteErr := deleter.DeleteURL(c.Request.Context(), current.ImageURL); deleteErr != nil {
					log.Printf("remove replaced gallery image: %v", deleteErr)
				}
			}
		}
		c.JSON(http.StatusOK, updated)
	}
}

func galleryCreationDeleteHandler(storage galleryImageStorage, store galleryCreationStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid gallery id"})
			return
		}
		deleted, err := store.DeleteGalleryCreation(c.Request.Context(), id)
		if errors.Is(err, errGalleryCreationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "gallery creation not found"})
			return
		}
		if err != nil {
			log.Printf("delete gallery creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gallery data could not be deleted"})
			return
		}
		if storage != nil {
			if deleter, ok := storage.(galleryImageURLDeleter); ok {
				if deleteErr := deleter.DeleteURL(c.Request.Context(), deleted.ImageURL); deleteErr != nil {
					log.Printf("remove deleted gallery image: %v", deleteErr)
				}
			}
		}
		c.Status(http.StatusNoContent)
	}
}

func parseGalleryMultipart(c *gin.Context) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxGalleryImageSize+2*1024*1024)
	return c.Request.ParseMultipartForm(maxGalleryImageSize + 2*1024*1024)
}

func galleryFormValues(c *gin.Context) (string, string, string, string) {
	return strings.TrimSpace(c.PostForm("title")), strings.TrimSpace(c.PostForm("model")), strings.TrimSpace(c.PostForm("prompt")), strings.TrimSpace(c.PostForm("image_url"))
}

func uploadGalleryFormImage(c *gin.Context, storage galleryImageStorage, imageURL string) (uploadedGalleryImage, string, error) {
	fileHeader, fileErr := c.FormFile("image")
	if errors.Is(fileErr, http.ErrMissingFile) {
		return uploadedGalleryImage{}, imageURL, nil
	}
	if fileErr != nil {
		return uploadedGalleryImage{}, imageURL, fileErr
	}
	if storage == nil {
		return uploadedGalleryImage{}, imageURL, errGalleryStorageNotConfigured
	}
	data, contentType, extension, err := readGalleryImage(fileHeader)
	if err != nil {
		return uploadedGalleryImage{}, imageURL, err
	}
	uploaded, err := storage.Upload(c.Request.Context(), extension, contentType, data)
	if err != nil {
		return uploadedGalleryImage{}, imageURL, err
	}
	return uploaded, uploaded.URL, nil
}

func respondGalleryImageError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errGalleryStorageNotConfigured):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OSS image storage is not configured"})
	case errors.Is(err, errGalleryImageTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image cannot exceed 10 MB"})
	case errors.Is(err, errGalleryImageType):
		c.JSON(http.StatusBadRequest, gin.H{"error": "only JPEG, PNG, GIF, and WebP images are supported"})
	default:
		log.Printf("gallery image operation: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "gallery image could not be uploaded"})
	}
}

func findGalleryCreation(ctx context.Context, store galleryCreationStore, id int64) (galleryCreation, error) {
	creations, err := store.ListGalleryCreations(ctx)
	if err != nil {
		return galleryCreation{}, err
	}
	for _, creation := range creations {
		if creation.ID == id {
			return creation, nil
		}
	}
	return galleryCreation{}, errGalleryCreationNotFound
}

func readGalleryImage(fileHeader *multipart.FileHeader) ([]byte, string, string, error) {
	if fileHeader == nil {
		return nil, "", "", errGalleryImageType
	}
	if fileHeader.Size > maxGalleryImageSize {
		return nil, "", "", errGalleryImageTooLarge
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, "", "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxGalleryImageSize+1))
	if err != nil {
		return nil, "", "", err
	}
	if int64(len(data)) > maxGalleryImageSize {
		return nil, "", "", errGalleryImageTooLarge
	}
	contentType := http.DetectContentType(data)
	extension := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/gif":  ".gif",
		"image/webp": ".webp",
	}[contentType]
	if extension == "" {
		return nil, "", "", errGalleryImageType
	}
	return data, contentType, extension, nil
}

func isValidGalleryImageURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Hostname() != "" && parsed.User == nil && (parsed.Scheme == "https" || parsed.Scheme == "http")
}

func steamOverviewHandler(store steamOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		overview, refreshedAt, err := store.LoadSteamOverview(c.Request.Context())
		if errors.Is(err, errSteamOverviewNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Steam data has not been refreshed yet"})
			return
		}
		if err != nil {
			log.Printf("load Steam overview snapshot: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Steam data is temporarily unavailable"})
			return
		}

		c.JSON(http.StatusOK, steamOverviewResponseFrom(overview, refreshedAt))
	}
}

func steamRefreshHandler(client *http.Client, apiKey string, steamID string, store steamOverviewStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if apiKey == "" || steamID == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Steam integration is not configured"})
			return
		}

		overview, err := fetchSteamOverview(c.Request.Context(), client, apiKey, steamID)
		if err != nil {
			log.Printf("refresh Steam overview: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Steam data is temporarily unavailable"})
			return
		}

		refreshedAt, err := store.SaveSteamOverview(c.Request.Context(), overview)
		if err != nil {
			log.Printf("save Steam overview snapshot: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Steam data could not be saved"})
			return
		}

		c.JSON(http.StatusOK, steamOverviewResponseFrom(overview, refreshedAt))
	}
}

func fetchSteamOverview(ctx context.Context, client *http.Client, apiKey string, steamID string) (steamOverview, error) {
	type playerSummary struct {
		Response struct {
			Players []struct {
				SteamID      string `json:"steamid"`
				PersonaName  string `json:"personaname"`
				ProfileURL   string `json:"profileurl"`
				AvatarFull   string `json:"avatarfull"`
				PersonaState int    `json:"personastate"`
			} `json:"players"`
		} `json:"response"`
	}
	type ownedGames struct {
		Response struct {
			GameCount int            `json:"game_count"`
			Games     []steamAPIGame `json:"games"`
		} `json:"response"`
	}
	type recentlyPlayedGames struct {
		Response struct {
			Games []steamAPIGame `json:"games"`
		} `json:"response"`
	}

	resolvedSteamID, err := resolveSteamID(ctx, client, apiKey, steamID)
	if err != nil {
		return steamOverview{}, err
	}

	query := url.Values{"key": {apiKey}, "steamid": {resolvedSteamID}}
	var summary playerSummary
	if err := steamGetJSON(ctx, client, "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?"+url.Values{"key": {apiKey}, "steamids": {resolvedSteamID}}.Encode(), &summary); err != nil {
		return steamOverview{}, err
	}
	if len(summary.Response.Players) == 0 {
		return steamOverview{}, fmt.Errorf("Steam player not found")
	}

	var owned ownedGames
	ownedURL := "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?" + withSteamGameOptions(query).Encode()
	if err := steamGetJSON(ctx, client, ownedURL, &owned); err != nil {
		return steamOverview{}, err
	}

	var recent recentlyPlayedGames
	recentURL := "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?" + query.Encode()
	if err := steamGetJSON(ctx, client, recentURL, &recent); err != nil {
		return steamOverview{}, err
	}

	totalPlaytime := 0
	for _, game := range owned.Response.Games {
		totalPlaytime += game.PlaytimeForever
	}
	sort.Slice(owned.Response.Games, func(left int, right int) bool {
		return owned.Response.Games[left].PlaytimeForever > owned.Response.Games[right].PlaytimeForever
	})
	player := summary.Response.Players[0]
	return steamOverview{
		Profile:        steamProfile{SteamID: player.SteamID, Name: player.PersonaName, ProfileURL: player.ProfileURL, AvatarURL: player.AvatarFull, PersonaState: player.PersonaState},
		GameCount:      owned.Response.GameCount,
		TotalPlaytime:  totalPlaytime,
		Games:          toSteamGames(owned.Response.Games),
		RecentlyPlayed: toSteamGames(recent.Response.Games),
	}, nil
}

func resolveSteamID(ctx context.Context, client *http.Client, apiKey string, identifier string) (string, error) {
	if steamIDPattern.MatchString(identifier) {
		return identifier, nil
	}

	type vanityResponse struct {
		Response struct {
			Success int    `json:"success"`
			SteamID string `json:"steamid"`
		} `json:"response"`
	}
	var response vanityResponse
	endpoint := "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?" + url.Values{"key": {apiKey}, "vanityurl": {identifier}}.Encode()
	if err := steamGetJSON(ctx, client, endpoint, &response); err != nil {
		return "", err
	}
	if response.Response.Success != 1 || !steamIDPattern.MatchString(response.Response.SteamID) {
		return "", fmt.Errorf("Steam vanity URL could not be resolved")
	}
	return response.Response.SteamID, nil
}

func toSteamGames(games []steamAPIGame) []steamGame {
	normalizedGames := make([]steamGame, 0, len(games))
	for _, game := range games {
		normalizedGames = append(normalizedGames, steamGame{AppID: game.AppID, Name: game.Name, PlaytimeForever: game.PlaytimeForever, Playtime2Weeks: game.Playtime2Weeks})
	}
	return normalizedGames
}

func withSteamGameOptions(query url.Values) url.Values {
	withOptions := url.Values{}
	for key, values := range query {
		withOptions[key] = append([]string(nil), values...)
	}
	withOptions.Set("include_appinfo", "1")
	withOptions.Set("include_played_free_games", "1")
	return withOptions
}

func steamGetJSON(ctx context.Context, client *http.Client, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create Steam request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "NextAlexBlog/1.0")

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request Steam API: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Steam returned %s", response.Status)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(target); err != nil {
		return fmt.Errorf("decode Steam response: %w", err)
	}
	return nil
}

type githubAPIProfile struct {
	Login       string `json:"login"`
	PublicRepos int    `json:"public_repos"`
	Followers   int    `json:"followers"`
}

func fetchGitHubAPIProfile(ctx context.Context, client *http.Client, username string) (githubAPIProfile, error) {
	endpoint := fmt.Sprintf("https://api.github.com/users/%s", url.PathEscape(username))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return githubAPIProfile{}, fmt.Errorf("create GitHub profile request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "NextAlexBlog/1.0 (+https://github.com/CbhHikari0828/NextAlexBlog)")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	response, err := client.Do(request)
	if err != nil {
		return githubAPIProfile{}, fmt.Errorf("request GitHub profile: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return githubAPIProfile{}, fmt.Errorf("GitHub returned %s", response.Status)
	}

	var apiProfile githubAPIProfile
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&apiProfile); err != nil {
		return githubAPIProfile{}, fmt.Errorf("decode GitHub profile: %w", err)
	}
	return apiProfile, nil
}

func githubProfileFrom(apiProfile githubAPIProfile, username string, repositories []githubRepository) githubProfile {
	stars, forks := 0, 0
	for _, repository := range repositories {
		stars += repository.Stars
		forks += repository.Forks
	}
	if apiProfile.Login == "" {
		apiProfile.Login = username
	}
	return githubProfile{Username: apiProfile.Login, RepositoryCount: apiProfile.PublicRepos, Stars: stars, Forks: forks, Followers: apiProfile.Followers}
}

func fetchGitHubProfile(ctx context.Context, client *http.Client, username string) (githubProfile, error) {
	apiProfile, err := fetchGitHubAPIProfile(ctx, client, username)
	if err != nil {
		return githubProfile{}, err
	}
	repositories, err := fetchGitHubRepositories(ctx, client, username, 100)
	if err != nil {
		return githubProfile{}, err
	}
	return githubProfileFrom(apiProfile, username, repositories.Repositories), nil
}

func fetchGitHubOverview(ctx context.Context, client *http.Client, username string, year int) (githubOverview, error) {
	apiProfile, err := fetchGitHubAPIProfile(ctx, client, username)
	if err != nil {
		return githubOverview{}, err
	}
	repositories, err := fetchGitHubRepositories(ctx, client, username, 100)
	if err != nil {
		return githubOverview{}, err
	}
	contributions, err := fetchGitHubContributions(ctx, client, username, year)
	if err != nil {
		return githubOverview{}, err
	}
	return githubOverview{
		Profile:       githubProfileFrom(apiProfile, username, repositories.Repositories),
		Repositories:  repositories.Repositories,
		Contributions: contributions,
	}, nil
}

func fetchGitHubRepositories(ctx context.Context, client *http.Client, username string, limit int) (githubRepositories, error) {
	query := url.Values{
		"direction": {"desc"},
		"per_page":  {strconv.Itoa(limit)},
		"sort":      {"updated"},
		"type":      {"owner"},
	}
	endpoint := fmt.Sprintf("https://api.github.com/users/%s/repos?%s", url.PathEscape(username), query.Encode())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return githubRepositories{}, fmt.Errorf("create GitHub repository request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "NextAlexBlog/1.0 (+https://github.com/CbhHikari0828/NextAlexBlog)")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	response, err := client.Do(request)
	if err != nil {
		return githubRepositories{}, fmt.Errorf("request GitHub repositories: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return githubRepositories{}, fmt.Errorf("GitHub returned %s", response.Status)
	}

	type githubAPIRepository struct {
		Name            string    `json:"name"`
		Description     *string   `json:"description"`
		HTMLURL         string    `json:"html_url"`
		Language        *string   `json:"language"`
		StargazersCount int       `json:"stargazers_count"`
		ForksCount      int       `json:"forks_count"`
		UpdatedAt       time.Time `json:"updated_at"`
	}
	var apiRepositories []githubAPIRepository
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&apiRepositories); err != nil {
		return githubRepositories{}, fmt.Errorf("decode GitHub repositories: %w", err)
	}

	repositories := make([]githubRepository, 0, len(apiRepositories))
	for _, repository := range apiRepositories {
		description := ""
		if repository.Description != nil {
			description = *repository.Description
		}
		language := ""
		if repository.Language != nil {
			language = *repository.Language
		}
		repositories = append(repositories, githubRepository{
			Name:        repository.Name,
			Description: description,
			HTMLURL:     repository.HTMLURL,
			Language:    language,
			Stars:       repository.StargazersCount,
			Forks:       repository.ForksCount,
			UpdatedAt:   repository.UpdatedAt.Format(time.RFC3339),
		})
	}

	return githubRepositories{Username: username, Repositories: repositories}, nil
}

func fetchGitHubContributions(ctx context.Context, client *http.Client, username string, year int) (githubContributions, error) {
	query := url.Values{
		"from": {fmt.Sprintf("%04d-01-01", year)},
		"to":   {fmt.Sprintf("%04d-12-31", year)},
	}
	endpoint := fmt.Sprintf("https://github.com/users/%s/contributions?%s", url.PathEscape(username), query.Encode())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return githubContributions{}, fmt.Errorf("create GitHub request: %w", err)
	}
	request.Header.Set("Accept", "text/html")
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	request.Header.Set("User-Agent", "NextAlexBlog/1.0 (+https://github.com/CbhHikari0828/NextAlexBlog)")

	response, err := client.Do(request)
	if err != nil {
		return githubContributions{}, fmt.Errorf("request GitHub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return githubContributions{}, fmt.Errorf("GitHub returned %s", response.Status)
	}

	document, err := html.Parse(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return githubContributions{}, fmt.Errorf("parse GitHub response: %w", err)
	}

	type calendarCell struct {
		id    string
		date  string
		level int
	}
	var cells []calendarCell
	tooltips := make(map[string]string)
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			attributes := htmlAttributes(node)
			switch node.Data {
			case "td":
				if strings.Contains(attributes["class"], "ContributionCalendar-day") && attributes["data-date"] != "" {
					level, err := strconv.Atoi(attributes["data-level"])
					if err == nil {
						cells = append(cells, calendarCell{id: attributes["id"], date: attributes["data-date"], level: max(0, min(level, 4))})
					}
				}
			case "tool-tip":
				if target := attributes["for"]; target != "" {
					tooltips[target] = strings.TrimSpace(htmlText(node))
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	if len(cells) == 0 {
		return githubContributions{}, errors.New("GitHub response did not contain contribution cells")
	}

	days := make([]contributionDay, 0, len(cells))
	total := 0
	for _, cell := range cells {
		count := contributionCount(tooltips[cell.id])
		days = append(days, contributionDay{Date: cell.date, Count: count, Level: cell.level})
		total += count
	}

	return githubContributions{Username: username, Year: year, Total: total, Days: days}, nil
}

func htmlAttributes(node *html.Node) map[string]string {
	attributes := make(map[string]string, len(node.Attr))
	for _, attribute := range node.Attr {
		attributes[attribute.Key] = attribute.Val
	}
	return attributes
}

func htmlText(node *html.Node) string {
	var text strings.Builder
	var walk func(*html.Node)
	walk = func(current *html.Node) {
		if current.Type == html.TextNode {
			text.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return text.String()
}

func contributionCount(tooltip string) int {
	match := contributionCountPattern.FindStringSubmatch(tooltip)
	if len(match) != 2 {
		return 0
	}
	count, err := strconv.Atoi(strings.ReplaceAll(match[1], ",", ""))
	if err != nil {
		return 0
	}
	return count
}

func healthHandler(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		context, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(context); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":   "degraded",
				"database": "offline",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":   "ok",
			"database": "online",
		})
	}
}

func envOrDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func loadLocalEnvironment() {
	for _, filename := range []string{".env", "../.env"} {
		file, err := os.Open(filename)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			key, value, found := strings.Cut(strings.TrimSpace(scanner.Text()), "=")
			if !found || key == "" || strings.HasPrefix(key, "#") {
				continue
			}
			if _, configured := os.LookupEnv(key); !configured {
				_ = os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"`))
			}
		}
		_ = file.Close()
		return
	}
}

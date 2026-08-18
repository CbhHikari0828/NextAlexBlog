package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/net/html"
)

var contributionCountPattern = regexp.MustCompile(`([0-9][0-9,]*)\s+contribution`)
var steamIDPattern = regexp.MustCompile(`^\d{17}$`)

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

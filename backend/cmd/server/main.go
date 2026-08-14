package main

import (
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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/net/html"
)

const githubContributionCacheDuration = 15 * time.Minute

var contributionCountPattern = regexp.MustCompile(`([0-9][0-9,]*)\s+contribution`)

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

type contributionCacheEntry struct {
	data      githubContributions
	expiresAt time.Time
}

type contributionCache struct {
	mu      sync.Mutex
	entries map[string]contributionCacheEntry
}

func newContributionCache() *contributionCache {
	return &contributionCache{entries: make(map[string]contributionCacheEntry)}
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

type repositoryCacheEntry struct {
	data      githubRepositories
	expiresAt time.Time
}

type repositoryCache struct {
	mu      sync.Mutex
	entries map[string]repositoryCacheEntry
}

func newRepositoryCache() *repositoryCache {
	return &repositoryCache{entries: make(map[string]repositoryCacheEntry)}
}

func main() {
	databaseURL := envOrDefault(
		"DATABASE_URL",
		"postgres://blog:blog_dev_password@localhost:55432/blog?sslmode=disable",
	)
	port := envOrDefault("BACKEND_PORT", "8090")
	githubUsername := envOrDefault("GITHUB_USERNAME", "CbhHikari0828")

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

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	router.GET("/api/health", healthHandler(pool))
	githubClient := &http.Client{Timeout: 10 * time.Second}
	router.GET("/api/github/contributions", githubContributionsHandler(
		githubClient,
		githubUsername,
		newContributionCache(),
	))
	router.GET("/api/github/repositories", githubRepositoriesHandler(
		githubClient,
		githubUsername,
		newRepositoryCache(),
	))

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

func githubContributionsHandler(client *http.Client, username string, cache *contributionCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		year := time.Now().Year()
		if requestedYear := c.Query("year"); requestedYear != "" {
			parsedYear, err := strconv.Atoi(requestedYear)
			if err != nil || parsedYear < 2008 || parsedYear > time.Now().Year() {
				c.JSON(http.StatusBadRequest, gin.H{"error": "year must be between 2008 and the current year"})
				return
			}
			year = parsedYear
		}

		cacheKey := fmt.Sprintf("%s:%d", username, year)
		cache.mu.Lock()
		entry, found := cache.entries[cacheKey]
		cache.mu.Unlock()
		if found && time.Now().Before(entry.expiresAt) {
			c.JSON(http.StatusOK, entry.data)
			return
		}

		contributions, err := fetchGitHubContributions(c.Request.Context(), client, username, year)
		if err != nil {
			log.Printf("fetch GitHub contributions for %s: %v", username, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub contribution data is temporarily unavailable"})
			return
		}

		cache.mu.Lock()
		cache.entries[cacheKey] = contributionCacheEntry{
			data:      contributions,
			expiresAt: time.Now().Add(githubContributionCacheDuration),
		}
		cache.mu.Unlock()

		c.JSON(http.StatusOK, contributions)
	}
}

func githubRepositoriesHandler(client *http.Client, username string, cache *repositoryCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := 3
		if requestedLimit := c.Query("limit"); requestedLimit != "" {
			parsedLimit, err := strconv.Atoi(requestedLimit)
			if err != nil || parsedLimit < 1 || parsedLimit > 6 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 6"})
				return
			}
			limit = parsedLimit
		}

		cacheKey := fmt.Sprintf("%s:%d", username, limit)
		cache.mu.Lock()
		entry, found := cache.entries[cacheKey]
		cache.mu.Unlock()
		if found && time.Now().Before(entry.expiresAt) {
			c.JSON(http.StatusOK, entry.data)
			return
		}

		repositories, err := fetchGitHubRepositories(c.Request.Context(), client, username, limit)
		if err != nil {
			log.Printf("fetch GitHub repositories for %s: %v", username, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub repository data is temporarily unavailable"})
			return
		}

		cache.mu.Lock()
		cache.entries[cacheKey] = repositoryCacheEntry{
			data:      repositories,
			expiresAt: time.Now().Add(githubContributionCacheDuration),
		}
		cache.mu.Unlock()

		c.JSON(http.StatusOK, repositories)
	}
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

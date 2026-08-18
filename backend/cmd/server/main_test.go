package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type memorySteamOverviewStore struct {
	overview    steamOverview
	refreshedAt time.Time
	hasSnapshot bool
	saveCount   int
}

type memoryGitHubOverviewStore struct {
	overview    githubOverview
	refreshedAt time.Time
	hasSnapshot bool
	saveCount   int
}

func (store *memoryGitHubOverviewStore) LoadGitHubOverview(context.Context) (githubOverview, time.Time, error) {
	if !store.hasSnapshot {
		return githubOverview{}, time.Time{}, errGitHubOverviewNotFound
	}
	return store.overview, store.refreshedAt, nil
}

func (store *memoryGitHubOverviewStore) SaveGitHubOverview(_ context.Context, overview githubOverview) (time.Time, error) {
	store.overview = overview
	store.refreshedAt = time.Date(2026, time.August, 18, 12, 0, 0, 0, time.UTC)
	store.hasSnapshot = true
	store.saveCount++
	return store.refreshedAt, nil
}

func (store *memorySteamOverviewStore) LoadSteamOverview(context.Context) (steamOverview, time.Time, error) {
	if !store.hasSnapshot {
		return steamOverview{}, time.Time{}, errSteamOverviewNotFound
	}
	return store.overview, store.refreshedAt, nil
}

func (store *memorySteamOverviewStore) SaveSteamOverview(_ context.Context, overview steamOverview) (time.Time, error) {
	store.overview = overview
	store.refreshedAt = time.Date(2026, time.August, 17, 12, 0, 0, 0, time.UTC)
	store.hasSnapshot = true
	store.saveCount++
	return store.refreshedAt, nil
}

func TestGitHubPublicReadsUseSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	refreshedAt := time.Date(2026, time.August, 18, 11, 0, 0, 0, time.UTC)
	store := &memoryGitHubOverviewStore{hasSnapshot: true, refreshedAt: refreshedAt, overview: githubOverview{
		Profile:       githubProfile{Username: "CbhHikari0828", RepositoryCount: 12, Stars: 70, Forks: 18, Followers: 32},
		Repositories:  []githubRepository{{Name: "NextAlexBlog", HTMLURL: "https://github.com/CbhHikari0828/NextAlexBlog"}},
		Contributions: githubContributions{Username: "CbhHikari0828", Year: 2026, Total: 4},
	}}

	router := gin.New()
	router.GET("/repositories", githubRepositoriesSnapshotHandler(store))
	router.GET("/profile", githubProfileSnapshotHandler(store))
	router.GET("/contributions", githubContributionsSnapshotHandler(store))
	for _, target := range []string{"/repositories?limit=1", "/profile", "/contributions?year=2026"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s returned %d", target, response.Code)
		}
	}
	if store.saveCount != 0 {
		t.Fatalf("public reads changed snapshot: saves=%d", store.saveCount)
	}
}

func TestGitHubRefreshStoresSnapshotForPublicReads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requestCount := 0
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		requestCount++
		body := `{"login":"CbhHikari0828","public_repos":12,"followers":32}`
		switch {
		case strings.Contains(request.URL.Path, "/repos"):
			body = `[{"name":"one","html_url":"https://github.com/CbhHikari0828/one","stargazers_count":68,"forks_count":15,"updated_at":"2026-08-18T00:00:00Z"},{"name":"two","html_url":"https://github.com/CbhHikari0828/two","stargazers_count":2,"forks_count":3,"updated_at":"2026-08-18T00:00:00Z"}]`
		case strings.Contains(request.URL.Path, "/contributions"):
			body = `<table><td class="ContributionCalendar-day" data-date="2026-08-17" data-level="2" id="day-1"></td><tool-tip for="day-1">4 contributions</tool-tip></table>`
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}

	store := &memoryGitHubOverviewStore{}
	router := gin.New()
	router.POST("/admin/github/refresh", githubRefreshHandler(client, "CbhHikari0828", store))
	router.GET("/profile", githubProfileSnapshotHandler(store))
	refreshResponse := httptest.NewRecorder()
	router.ServeHTTP(refreshResponse, httptest.NewRequest(http.MethodPost, "/admin/github/refresh", nil))
	if refreshResponse.Code != http.StatusOK {
		t.Fatalf("POST /admin/github/refresh returned %d", refreshResponse.Code)
	}
	if requestCount != 3 || store.saveCount != 1 || store.overview.Profile.Stars != 70 {
		t.Fatalf("unexpected refresh result: requests=%d saves=%d stars=%d", requestCount, store.saveCount, store.overview.Profile.Stars)
	}
	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, httptest.NewRequest(http.MethodGet, "/profile", nil))
	if publicResponse.Code != http.StatusOK || requestCount != 3 {
		t.Fatalf("public GitHub read made an external request or failed: status=%d requests=%d", publicResponse.Code, requestCount)
	}
}

func TestSteamOverviewReadsSnapshotWithoutSteamRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	refreshedAt := time.Date(2026, time.August, 17, 11, 30, 0, 0, time.UTC)
	store := &memorySteamOverviewStore{hasSnapshot: true, refreshedAt: refreshedAt, overview: steamOverview{
		Profile:   steamProfile{Name: "NextAlex"},
		GameCount: 2,
		Games:     []steamGame{{AppID: 10, Name: "Counter-Strike"}},
	}}
	router := gin.New()
	router.GET("/steam", steamOverviewHandler(store))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/steam", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET /steam returned %d", response.Code)
	}

	var payload steamOverviewResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Profile.Name != "NextAlex" || payload.GameCount != 2 || !payload.RefreshedAt.Equal(refreshedAt) {
		t.Fatalf("unexpected snapshot response: %+v", payload)
	}
}

func TestSteamOverviewReportsMissingSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/steam", steamOverviewHandler(&memorySteamOverviewStore{}))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/steam", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("GET /steam returned %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestSteamRefreshStoresSnapshotForPublicReads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requestCount := 0
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		requestCount++
		body := ""
		switch {
		case strings.Contains(request.URL.Path, "GetPlayerSummaries"):
			body = `{"response":{"players":[{"steamid":"76561198000000000","personaname":"NextAlex","profileurl":"https://steamcommunity.com/id/nextalex","avatarfull":"https://example.com/avatar.jpg","personastate":1}]}}`
		case strings.Contains(request.URL.Path, "GetOwnedGames"):
			body = `{"response":{"game_count":17,"games":[{"appid":1,"name":"Game 1","playtime_forever":17},{"appid":2,"name":"Game 2","playtime_forever":16},{"appid":3,"name":"Game 3","playtime_forever":15},{"appid":4,"name":"Game 4","playtime_forever":14},{"appid":5,"name":"Game 5","playtime_forever":13},{"appid":6,"name":"Game 6","playtime_forever":12},{"appid":7,"name":"Game 7","playtime_forever":11},{"appid":8,"name":"Game 8","playtime_forever":10},{"appid":9,"name":"Game 9","playtime_forever":9},{"appid":10,"name":"Game 10","playtime_forever":8},{"appid":11,"name":"Game 11","playtime_forever":7},{"appid":12,"name":"Game 12","playtime_forever":6},{"appid":13,"name":"Game 13","playtime_forever":5},{"appid":14,"name":"Game 14","playtime_forever":4},{"appid":15,"name":"Game 15","playtime_forever":3},{"appid":16,"name":"Game 16","playtime_forever":2},{"appid":17,"name":"Game 17","playtime_forever":1}]}}`
		case strings.Contains(request.URL.Path, "GetRecentlyPlayedGames"):
			body = `{"response":{"games":[{"appid":1,"name":"Game 1","playtime_forever":17,"playtime_2weeks":3}]}}`
		default:
			t.Fatalf("unexpected Steam endpoint: %s", request.URL.Path)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	store := &memorySteamOverviewStore{}
	router := gin.New()
	router.POST("/admin/steam/refresh", steamRefreshHandler(client, "steam-key", "76561198000000000", store))
	router.GET("/steam", steamOverviewHandler(store))

	refreshResponse := httptest.NewRecorder()
	router.ServeHTTP(refreshResponse, httptest.NewRequest(http.MethodPost, "/admin/steam/refresh", nil))
	if refreshResponse.Code != http.StatusOK {
		t.Fatalf("POST /admin/steam/refresh returned %d", refreshResponse.Code)
	}
	if requestCount != 3 || store.saveCount != 1 || len(store.overview.Games) != 17 {
		t.Fatalf("unexpected refresh result: requests=%d saves=%d games=%d", requestCount, store.saveCount, len(store.overview.Games))
	}

	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, httptest.NewRequest(http.MethodGet, "/steam", nil))
	if publicResponse.Code != http.StatusOK {
		t.Fatalf("GET /steam returned %d", publicResponse.Code)
	}
	if requestCount != 3 {
		t.Fatalf("public Steam read made %d API requests, want 3", requestCount)
	}
}

func TestSteamRefreshRequiresConfiguration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/admin/steam/refresh", steamRefreshHandler(http.DefaultClient, "", "", &memorySteamOverviewStore{}))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/admin/steam/refresh", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("POST /admin/steam/refresh returned %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestResolveSteamIDSupportsVanityName(t *testing.T) {
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if !strings.Contains(request.URL.Path, "ResolveVanityURL") {
			t.Fatalf("unexpected Steam endpoint: %s", request.URL.Path)
		}
		if request.URL.Query().Get("vanityurl") != "abc9_10" {
			t.Fatalf("vanity URL = %q", request.URL.Query().Get("vanityurl"))
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"response":{"success":1,"steamid":"76561198000000000"}}`)), Request: request}, nil
	})}

	steamID, err := resolveSteamID(context.Background(), client, "steam-key", "abc9_10")
	if err != nil {
		t.Fatalf("resolveSteamID returned error: %v", err)
	}
	if steamID != "76561198000000000" {
		t.Fatalf("SteamID = %q", steamID)
	}
}

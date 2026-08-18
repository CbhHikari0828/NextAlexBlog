package main

import (
	"context"
	"encoding/json"
	"errors"
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

type memoryMusicPreferenceStore struct {
	preferences []musicPreference
	nextID      int64
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

func (store *memoryMusicPreferenceStore) ListMusicPreferences(context.Context) ([]musicPreference, error) {
	return append([]musicPreference(nil), store.preferences...), nil
}

func (store *memoryMusicPreferenceStore) SaveMusicPreference(_ context.Context, preference musicPreference) (musicPreference, error) {
	for index, existing := range store.preferences {
		if existing.ExternalURL == preference.ExternalURL {
			preference.ID = existing.ID
			store.preferences[index] = preference
			return preference, nil
		}
	}
	store.nextID++
	preference.ID = store.nextID
	store.preferences = append([]musicPreference{preference}, store.preferences...)
	return preference, nil
}

func (store *memoryMusicPreferenceStore) DeleteMusicPreference(_ context.Context, id int64) error {
	for index, preference := range store.preferences {
		if preference.ID == id {
			store.preferences = append(store.preferences[:index], store.preferences[index+1:]...)
			return nil
		}
	}
	return errMusicPreferenceNotFound
}

func TestAppleMusicImportStoresAndPublishesMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requestCount := 0
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		requestCount++
		if request.URL.Hostname() != "music.apple.com" {
			t.Fatalf("Apple Music request host = %q", request.URL.Hostname())
		}
		body := `<html><head>
			<meta property="og:image" content="https://example.com/cover.jpg">
			<script id="schema:song" type="application/ld+json">{"@context":"http://schema.org","@type":"MusicComposition","name":"Serenade (KARINA & WINTER)","url":"https://music.apple.com/cn/song/serenade-karina-winter/6797481677","datePublished":"2026-08-09","timeRequired":"PT3M5S","genre":["K-Pop","Music"],"audio":{"byArtist":[{"name":"aespa"}],"inAlbum":{"name":"SYNK : aeXIS LINE","image":"https://example.com/album.png"}}}</script>
		</head></html>`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	store := &memoryMusicPreferenceStore{}
	router := gin.New()
	router.POST("/admin/music/import", musicImportHandler(client, store))
	router.GET("/music", musicPreferencesHandler(store))
	router.DELETE("/admin/music/:id", musicDeleteHandler(store))

	importResponse := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/music/import", strings.NewReader(`{"url":"https://music.apple.com/cn/album/serenade-karina-winter/6797481676?i=6797481677"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(importResponse, request)
	if importResponse.Code != http.StatusOK {
		t.Fatalf("POST /admin/music/import returned %d: %s", importResponse.Code, importResponse.Body.String())
	}
	var imported musicPreference
	if err := json.Unmarshal(importResponse.Body.Bytes(), &imported); err != nil {
		t.Fatalf("decode import response: %v", err)
	}
	if imported.Title != "Serenade (KARINA & WINTER)" || imported.Artist != "aespa" || imported.Duration != "3:05" || imported.Genre != "K-Pop" {
		t.Fatalf("unexpected imported metadata: %+v", imported)
	}

	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, httptest.NewRequest(http.MethodGet, "/music", nil))
	if publicResponse.Code != http.StatusOK || requestCount != 1 {
		t.Fatalf("GET /music returned %d after %d external requests", publicResponse.Code, requestCount)
	}

	deleteResponse := httptest.NewRecorder()
	router.ServeHTTP(deleteResponse, httptest.NewRequest(http.MethodDelete, "/admin/music/1", nil))
	if deleteResponse.Code != http.StatusNoContent || len(store.preferences) != 0 {
		t.Fatalf("DELETE /admin/music/1 returned %d with %d records remaining", deleteResponse.Code, len(store.preferences))
	}
}

func TestAppleMusicImportRejectsOtherHosts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/admin/music/import", musicImportHandler(http.DefaultClient, &memoryMusicPreferenceStore{}))

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/music/import", strings.NewReader(`{"url":"https://example.com/music"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("POST /admin/music/import returned %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestQQMusicImportParsesPublicJSONLD(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Hostname() != "i.y.qq.com" || request.URL.Query().Get("songmid") != "001" {
			t.Fatalf("QQ Music request host = %q", request.URL.Hostname())
		}
		body := `<html><head>
			<script type="application/ld+json">{"@type":"MusicRecording","name":"晴天","byArtist":{"name":"周杰伦"},"inAlbum":{"name":"叶惠美"},"duration":"PT4M29S","datePublished":"2003-07-31","genre":"Mandopop","image":"https://y.qq.com/cover/qingtian.jpg"}</script>
		</head></html>`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	store := &memoryMusicPreferenceStore{}
	router := gin.New()
	router.POST("/admin/music/import", musicImportHandler(client, store))
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/music/import", strings.NewReader(`{"url":"https://y.qq.com/n/ryqq/songDetail/001"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST /admin/music/import returned %d: %s", response.Code, response.Body.String())
	}
	var imported musicPreference
	if err := json.Unmarshal(response.Body.Bytes(), &imported); err != nil {
		t.Fatalf("decode QQ Music response: %v", err)
	}
	if imported.Title != "晴天" || imported.Artist != "周杰伦" || imported.Album != "叶惠美" || imported.Duration != "4:29" || imported.CoverURL == "" {
		t.Fatalf("unexpected QQ Music metadata: %+v", imported)
	}
}

func TestQQMusicImportParsesPublicSSRScript(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body := `<html><head><script>window.__ssrFirstPageData__="{\"song\":{\"name\":\"晴天\",\"singer\":[{\"name\":\"周杰伦\"}],\"album\":{\"name\":\"叶惠美\"},\"interval\":269,\"time_public\":\"2003-07-31\",\"img\":\"https://y.qq.com/cover/qingtian.jpg\"}}"</script></head></html>`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	preference, err := fetchMusicPreference(context.Background(), client, "https://i.y.qq.com/v8/playsong.html?songmid=001")
	if err != nil {
		t.Fatalf("fetch QQ Music public SSR metadata: %v", err)
	}
	if preference.Title != "晴天" || preference.Artist != "周杰伦" || preference.Album != "叶惠美" || preference.Duration != "4:29" || preference.ReleaseDate != "2003-07-31" {
		t.Fatalf("unexpected QQ Music SSR metadata: %+v", preference)
	}
}

func TestNetEaseMusicImportParsesPublicPageScript(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Hostname() != "music.163.com" {
			t.Fatalf("NetEase request host = %q", request.URL.Hostname())
		}
		if request.URL.Path != "/song" || request.URL.Query().Get("id") != "123" {
			t.Fatalf("NetEase request URL = %s, want /song?id=123", request.URL.String())
		}
		body := `<html><head>
			<title>稻香 - 网易云音乐</title>
			<meta property="og:image" content="http://p1.music.126.net/cover/daoxiang.jpg">
			<meta name="description" content="歌手：周杰伦｜专辑：魔杰座">
			<script>window.__SONG__={"songname":"稻香","singername":"周杰伦","albumname":"魔杰座","duration":"285","genre":"Pop"};</script>
		</head></html>`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	store := &memoryMusicPreferenceStore{}
	router := gin.New()
	router.POST("/admin/music/import", musicImportHandler(client, store))
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/music/import", strings.NewReader(`{"url":"https://music.163.com/#/song?id=123"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST /admin/music/import returned %d: %s", response.Code, response.Body.String())
	}
	var imported musicPreference
	if err := json.Unmarshal(response.Body.Bytes(), &imported); err != nil {
		t.Fatalf("decode NetEase response: %v", err)
	}
	if imported.Title != "稻香" || imported.Artist != "周杰伦" || imported.Album != "魔杰座" || imported.Duration != "285" || imported.CoverURL != "https://p1.music.126.net/cover/daoxiang.jpg" {
		t.Fatalf("unexpected NetEase metadata: %+v", imported)
	}
}

func TestMusicURLValidationRequiresSupportedHTTPSHost(t *testing.T) {
	for _, rawURL := range []string{
		"http://music.apple.com/cn/song/1",
		"https://y.qq.com:8443/song/1",
		"https://music.163.com.evil.example/song/1",
		"https://example.com/music",
	} {
		if _, _, err := validateMusicURL(rawURL); !errors.Is(err, errInvalidMusicURL) {
			t.Fatalf("validateMusicURL(%q) error = %v, want invalid music URL", rawURL, err)
		}
	}
}

func TestNetEaseDescriptionFallbackUsesPublicMetadata(t *testing.T) {
	pageURL, _, err := validateMusicURL("https://music.163.com/song?id=186016")
	if err != nil {
		t.Fatalf("validate NetEase URL: %v", err)
	}
	metadata := musicMetadataFromDocument(musicHTMLDocument{Metadata: map[string]string{
		"og:title":    "晴天",
		"og:image":    "http://p1.music.126.net/ZGffiDQZrGj5s_hnR1CNbg==/109951165566379710.jpg",
		"description": "歌曲名《晴天》，别名《Sunny Day》，由 周杰伦 演唱，收录于《叶惠美》专辑中。",
	}}, pageURL)
	if metadata.Title != "晴天" || metadata.Artist != "周杰伦" || metadata.Album != "叶惠美" || !strings.HasPrefix(metadata.CoverURL, "https://") {
		t.Fatalf("unexpected NetEase public metadata: %+v", metadata)
	}
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

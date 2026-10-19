package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestArticleAssistantConfigDefaultsToCurrentDeepSeekModel(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	t.Setenv("DEEPSEEK_MODEL", "  ")
	t.Setenv("DEEPSEEK_BASE_URL", " https://api.deepseek.com/ ")
	t.Setenv("DEEPSEEK_TIMEOUT_SECONDS", "")
	t.Setenv("DEEPSEEK_MAX_OUTPUT_TOKENS", "")

	config := newArticleAssistantConfigFromEnvironment()
	if config.Model != "deepseek-v4-pro" {
		t.Fatalf("default model = %q, want deepseek-v4-pro", config.Model)
	}
	if config.BaseURL != "https://api.deepseek.com" {
		t.Fatalf("default base URL = %q, want https://api.deepseek.com", config.BaseURL)
	}
}

func TestRetrieveArticleContextUsesPublishedArticlesAndPrioritizesCurrent(t *testing.T) {
	articles := []articleRecord{
		{
			ID:      1,
			Slug:    "thread-pool",
			Title:   "线程池实践",
			Summary: "核心线程与工作队列",
			Content: "## 工作队列\n\n任务会先进入工作队列，队列满后再创建非核心线程。",
			Status:  "published",
		},
		{
			ID:      2,
			Slug:    "queue-comparison",
			Title:   "队列比较",
			Content: "工作队列需要根据吞吐量选择容量。",
			Status:  "published",
		},
		{
			ID:      3,
			Slug:    "draft-secret",
			Title:   "草稿",
			Content: "工作队列的未发布秘密是 draft-only-token。",
			Status:  "draft",
		},
	}

	retrieved := retrieveArticleContext(articles, 1, "工作队列如何处理任务？")
	if len(retrieved) == 0 {
		t.Fatal("expected relevant published chunks")
	}
	if retrieved[0].Source.ArticleID != 1 {
		t.Fatalf("first source article = %d, want current article 1", retrieved[0].Source.ArticleID)
	}
	for _, source := range retrieved {
		if source.Source.ArticleID == 3 || strings.Contains(source.Text, "draft-only-token") {
			t.Fatalf("draft content leaked into retrieval: %#v", source)
		}
	}

	summary := retrieveArticleContext(articles, 1, "请总结这篇文章")
	if len(summary) == 0 || summary[0].Source.ArticleID != 1 {
		t.Fatalf("generic current-article question did not retrieve current article: %#v", summary)
	}
	if unrelated := retrieveArticleContext(articles, 1, "法国首都和天气是什么？"); len(unrelated) != 0 {
		t.Fatalf("unrelated query unexpectedly retrieved sources: %#v", unrelated)
	}
}

func TestRetrieveArticleContextForcesCurrentArticleIntoGenericSummary(t *testing.T) {
	articles := []articleRecord{
		{
			ID:      1,
			Slug:    "current",
			Title:   "当前文章",
			Content: "## 核心结论\n\n当前文章的独特结论。",
			Status:  "published",
		},
		{
			ID:      2,
			Slug:    "matching",
			Title:   "文章总结",
			Content: "## 总结\n\n这篇文章总结了另一组内容。",
			Status:  "published",
		},
	}

	retrieved := retrieveArticleContext(articles, 1, "请总结这篇文章")
	if len(retrieved) == 0 {
		t.Fatal("expected summary context")
	}
	if retrieved[0].Source.ArticleID != 1 {
		t.Fatalf("first source article = %d, want current article 1", retrieved[0].Source.ArticleID)
	}
}

func TestRetrieveArticleContextPrioritizesCurrentArticleWhenItMatches(t *testing.T) {
	articles := []articleRecord{
		{
			ID:      1,
			Slug:    "current",
			Title:   "当前文章",
			Content: "## 可见性\n\nvolatile 适合状态标记这类简单场景。",
			Status:  "published",
		},
		{
			ID:      2,
			Slug:    "related",
			Title:   "相关文章",
			Content: "## 可见性\n\nvolatile 适合状态标记这类简单场景。",
			Status:  "published",
		},
	}

	retrieved := retrieveArticleContext(articles, 1, "volatile 适合什么场景？")
	if len(retrieved) == 0 {
		t.Fatal("expected matching context")
	}
	if retrieved[0].Source.ArticleID != 1 {
		t.Fatalf("first source article = %d, want current article 1", retrieved[0].Source.ArticleID)
	}
}

func TestRetrieveArticleContextMatchesArticleMetadata(t *testing.T) {
	articles := []articleRecord{
		{
			ID:       1,
			Slug:     "fork-join",
			Title:    "并发实践",
			Category: "Java",
			Tags:     []string{"ForkJoin"},
			Content:  "线程协作需要清晰的任务边界。",
			Status:   "published",
		},
		{
			ID:      2,
			Slug:    "database",
			Title:   "数据库实践",
			Content: "索引可以减少查询扫描范围。",
			Status:  "published",
		},
	}

	retrieved := retrieveArticleContext(articles, 0, "ForkJoin")
	if len(retrieved) == 0 {
		t.Fatal("expected metadata-only query to retrieve an article")
	}
	if retrieved[0].Source.ArticleID != 1 {
		t.Fatalf("first source article = %d, want metadata-matching article 1", retrieved[0].Source.ArticleID)
	}
}

func TestRetrieveArticleContextRejectsUnrelatedLegacyCorpus(t *testing.T) {
	articles := legacyArticles()
	query := "法国首都和天气是什么？"
	retrieved := retrieveArticleContext(articles, 1, query)
	if len(retrieved) != 0 {
		t.Fatalf("unrelated query unexpectedly retrieved %d sources", len(retrieved))
	}
}

func TestRetrieveArticleContextKeepsTechnicalTermsAfterQuestionFiltering(t *testing.T) {
	for _, test := range []struct {
		query string
		want  bool
	}{
		{query: "什么是工作队列？", want: true},
		{query: "happens-before 是什么？", want: true},
		{query: "锁", want: true},
	} {
		t.Run(test.query, func(t *testing.T) {
			retrieved := retrieveArticleContext(legacyArticles(), 0, test.query)
			if (len(retrieved) > 0) != test.want {
				t.Fatalf("query %q retrieved %d sources, want match=%v", test.query, len(retrieved), test.want)
			}
		})
	}
	for _, test := range []struct {
		token string
		want  bool
	}{
		{token: "什么", want: false},
		{token: "是什", want: false},
		{token: "锁", want: true},
		{token: "工作", want: true},
		{token: "ForkJoin", want: true},
	} {
		if got := assistantSearchToken(test.token); got != test.want {
			t.Fatalf("assistantSearchToken(%q) = %v, want %v", test.token, got, test.want)
		}
	}
}

func TestAssistantSystemPromptRequiresSubstantiveAnswerBeforeCitations(t *testing.T) {
	prompt := assistantSystemPrompt([]assistantRetrievedChunk{{
		Source: assistantSource{ID: "S1", ArticleID: 1, Title: "线程池实践"},
		Text:   "任务会先进入工作队列。",
	}})

	for _, expected := range []string{
		"必须先直接回答用户的问题",
		"明确结论和基于文章内容的解释",
		"不得只回复来源编号、文章标题、链接、“见链接”或“请看文章”",
		"引用只能作为相关结论或解释之后的佐证",
		"每个事实性结论后必须紧跟对应来源编号",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("system prompt is missing substantive-answer constraint %q: %s", expected, prompt)
		}
	}
}

func TestArticleAssistantStreamsDeepSeekAnswerAndServerSources(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := assistantTestArticleStore()
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		if request.URL.Path != "/chat/completions" {
			t.Errorf("upstream path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected Authorization header")
		}
		var payload deepSeekChatRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode upstream payload: %v", err)
		}
		if payload.Model != "deepseek-flash" || !payload.Stream {
			t.Errorf("unexpected upstream payload: %#v", payload)
		}
		if payload.ReasoningEffort != "none" {
			t.Errorf("reasoning_effort = %q, want none", payload.ReasoningEffort)
		}
		system := payload.Messages[0].Content
		if !strings.Contains(system, "工作队列") || strings.Contains(system, "draft-only-token") {
			t.Errorf("system evidence did not contain only published context: %q", system)
		}
		if !strings.Contains(system, "只能使用来源编号 S1 到 S") {
			t.Errorf("system prompt did not constrain citation ids: %q", system)
		}
		if !strings.Contains(system, "当前打开文章") || !strings.Contains(system, "用户当前正在阅读的文章对应来源编号是 S1") {
			t.Errorf("system prompt did not identify the current article sources: %q", system)
		}

		writer.Header().Set("Content-Type", "text/event-stream")
		writer.(http.Flusher).Flush()
		time.Sleep(12 * time.Millisecond)
		_, _ = io.WriteString(writer, "data: {\"choices\":[{\"delta\":{\"content\":\"任务先进入队列\"}}]}\n\n")
		_, _ = io.WriteString(writer, "data: {\"choices\":[{\"delta\":{\"content\":\" [S1]\"}}]}\n\n")
		_, _ = io.WriteString(writer, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	assistant := newArticleAssistant(store, articleAssistantConfig{
		APIKey:          "test-key",
		BaseURL:         upstream.URL,
		Model:           "deepseek-flash",
		Timeout:         time.Second,
		MaxOutputTokens: 256,
	})
	assistant.heartbeatInterval = 5 * time.Millisecond
	router := gin.New()
	router.POST("/api/articles/:id/assistant", articleAssistantHandler(assistant))

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/articles/1/assistant", strings.NewReader(`{"message":"工作队列如何处理任务？","history":[]}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("assistant response = %d: %s", response.Code, response.Body.String())
	}
	if upstreamCalls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", upstreamCalls.Load())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("Content-Type = %q", contentType)
	}
	if response.Header().Get("X-Accel-Buffering") != "no" || !strings.Contains(response.Header().Get("Cache-Control"), "no-cache") {
		t.Fatalf("missing SSE proxy headers: %#v", response.Header())
	}
	body := response.Body.String()
	for _, expected := range []string{
		"event: sources",
		": heartbeat",
		`"articleId":1`,
		"event: delta",
		`"content":"任务先进入队列"`,
		"event: done",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("SSE body does not contain %q: %s", expected, body)
		}
	}
}

func TestGlobalArticleAssistantStreamsRelevantSourcesWithoutArticleSelection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &assistantArticleStoreSpy{articleStore: assistantTestArticleStore()}
	var systemPrompt string
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload deepSeekChatRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode upstream payload: %v", err)
		}
		if len(payload.Messages) == 0 {
			t.Fatal("expected assistant messages")
		}
		systemPrompt = payload.Messages[0].Content

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(writer, "data: {\"choices\":[{\"delta\":{\"content\":\"任务会先进入工作队列 [S1]\"}}]}\n\n")
		_, _ = io.WriteString(writer, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	assistant := newArticleAssistant(store, articleAssistantConfig{
		APIKey:          "test-key",
		BaseURL:         upstream.URL,
		Model:           "deepseek-flash",
		Timeout:         time.Second,
		MaxOutputTokens: 256,
	})
	router := gin.New()
	router.POST("/api/assistant", globalArticleAssistantHandler(assistant))

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/assistant", strings.NewReader(`{"message":"工作队列如何处理任务？"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("assistant response = %d: %s", response.Code, response.Body.String())
	}
	if store.getArticleCalls != 0 {
		t.Fatalf("global assistant called GetArticle %d times, want 0", store.getArticleCalls)
	}
	if strings.Contains(systemPrompt, "当前打开文章") || strings.Contains(systemPrompt, "用户当前正在阅读") {
		t.Fatalf("global system prompt retained current-article instructions: %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "优先依据和问题最相关的已发布文章") {
		t.Fatalf("global system prompt is missing global retrieval guidance: %q", systemPrompt)
	}
	for _, expected := range []string{
		"event: sources",
		`"articleId":1`,
		`"slug":"thread-pool"`,
		`"title":"线程池实践"`,
		"event: delta",
		"event: done",
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("SSE body does not contain %q: %s", expected, response.Body.String())
		}
	}
}

func TestGlobalArticleAssistantRefusesUnsupportedQuestionWithoutCallingDeepSeek(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assistant := newArticleAssistant(assistantTestArticleStore(), articleAssistantConfig{
		APIKey:          "test-key",
		BaseURL:         "https://example.invalid",
		Model:           "deepseek-flash",
		Timeout:         time.Second,
		MaxOutputTokens: 256,
	})
	assistant.client = &http.Client{Transport: assistantRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("DeepSeek must not be called for an unsupported question")
		return nil, nil
	})}
	router := gin.New()
	router.POST("/api/assistant", globalArticleAssistantHandler(assistant))

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/assistant", strings.NewReader(`{"message":"法国首都和天气是什么？"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), articleAssistantRefusal) {
		t.Fatalf("unsupported response = %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"sources":[]`) {
		t.Fatalf("unsupported response exposed sources: %s", response.Body.String())
	}
}

func TestArticleAssistantMapsUpstreamRateLimitAndTimeout(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name       string
		transport  assistantRoundTripperFunc
		wantStatus int
		wantCode   string
	}{
		{
			name: "rate limit",
			transport: func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusTooManyRequests,
					Header:     http.Header{"Retry-After": []string{"9"}},
					Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"quota"}}`)),
				}, nil
			},
			wantStatus: http.StatusTooManyRequests,
			wantCode:   "assistant_rate_limited",
		},
		{
			name: "timeout",
			transport: func(request *http.Request) (*http.Response, error) {
				<-request.Context().Done()
				return nil, request.Context().Err()
			},
			wantStatus: http.StatusGatewayTimeout,
			wantCode:   "assistant_timeout",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assistant := newArticleAssistant(assistantTestArticleStore(), articleAssistantConfig{
				APIKey:          "test-key",
				BaseURL:         "https://api.deepseek.test",
				Model:           "deepseek-flash",
				Timeout:         10 * time.Millisecond,
				MaxOutputTokens: 256,
			})
			assistant.client = &http.Client{Transport: test.transport}
			router := gin.New()
			router.POST("/articles/:id/assistant", articleAssistantHandler(assistant))

			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/articles/1/assistant", strings.NewReader(`{"message":"工作队列是什么？"}`))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)

			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantCode) {
				t.Fatalf("response = %d: %s", response.Code, response.Body.String())
			}
			if test.name == "rate limit" && response.Header().Get("Retry-After") != "9" {
				t.Fatalf("Retry-After = %q", response.Header().Get("Retry-After"))
			}
		})
	}
}

func TestArticleAssistantValidatesInputAndPublishedArticle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assistant := newArticleAssistant(assistantTestArticleStore(), articleAssistantConfig{})
	router := gin.New()
	router.POST("/articles/:id/assistant", articleAssistantHandler(assistant))

	tests := []struct {
		name       string
		path       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{name: "invalid id", path: "/articles/nope/assistant", body: `{"message":"test"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_article_id"},
		{name: "draft article", path: "/articles/2/assistant", body: `{"message":"工作队列"}`, wantStatus: http.StatusNotFound, wantCode: "article_not_found"},
		{name: "long question", path: "/articles/1/assistant", body: `{"message":"` + strings.Repeat("问", articleAssistantMaxQuestionRunes+1) + `"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request"},
		{name: "large body", path: "/articles/1/assistant", body: `{"message":"工作队列","unknown":"` + strings.Repeat("x", articleAssistantMaxBodyBytes) + `"}`, wantStatus: http.StatusRequestEntityTooLarge, wantCode: "request_too_large"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantCode) {
				t.Fatalf("response = %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestArticleAssistantGuardLimitsPerIPConcurrencyAndMemory(t *testing.T) {
	now := time.Date(2026, time.October, 19, 10, 0, 0, 0, time.UTC)
	guard := newArticleAssistantGuard(2, time.Minute, 2, 1)
	guard.now = func() time.Time { return now }

	if allowed, _ := guard.allow("one"); !allowed {
		t.Fatal("first request should be allowed")
	}
	if allowed, _ := guard.allow("one"); !allowed {
		t.Fatal("second request should be allowed")
	}
	if allowed, retry := guard.allow("one"); allowed || retry <= 0 {
		t.Fatalf("third request = allowed %v, retry %s", allowed, retry)
	}
	if release, ok := guard.tryAcquire(); !ok {
		t.Fatal("first concurrent request should be admitted")
	} else {
		if _, secondOK := guard.tryAcquire(); secondOK {
			t.Fatal("second concurrent request should be rejected")
		}
		release()
	}

	_, _ = guard.allow("two")
	_, _ = guard.allow("three")
	if len(guard.entries) != 2 {
		t.Fatalf("rate map contains %d entries, want bounded size 2", len(guard.entries))
	}
	now = now.Add(time.Minute)
	if allowed, _ := guard.allow("one"); !allowed {
		t.Fatal("request should be allowed in the next window")
	}
}

func assistantTestArticleStore() *memoryArticleStore {
	return &memoryArticleStore{articles: []articleRecord{
		{
			ID:       1,
			Slug:     "thread-pool",
			Title:    "线程池实践",
			Summary:  "核心线程与工作队列",
			Category: "Java",
			Content:  "## 工作队列\n\n任务会先进入工作队列，队列满后再创建非核心线程。",
			Status:   "published",
		},
		{
			ID:      2,
			Slug:    "draft",
			Title:   "草稿",
			Content: "工作队列的未发布内容 draft-only-token。",
			Status:  "draft",
		},
	}}
}

type assistantArticleStoreSpy struct {
	articleStore
	getArticleCalls int
}

func (store *assistantArticleStoreSpy) GetArticle(ctx context.Context, id int64, includeDrafts bool) (articleRecord, error) {
	store.getArticleCalls++
	return store.articleStore.GetArticle(ctx, id, includeDrafts)
}

type assistantRoundTripperFunc func(*http.Request) (*http.Response, error)

func (function assistantRoundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

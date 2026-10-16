package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type articleRecord struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Summary   string    `json:"summary"`
	Content   string    `json:"content"`
	Category  string    `json:"category"`
	Series    string    `json:"series"`
	Tags      []string  `json:"tags"`
	Date      string    `json:"date"`
	ReadTime  string    `json:"readTime"`
	Views     int       `json:"views"`
	Likes     int       `json:"likes"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type articleStore interface {
	ListArticles(context.Context, bool) ([]articleRecord, error)
	GetArticle(context.Context, int64, bool) (articleRecord, error)
	CreateArticle(context.Context, articleRecord) (articleRecord, error)
	UpdateArticle(context.Context, articleRecord) (articleRecord, error)
	DeleteArticle(context.Context, int64) error
	SeedArticle(context.Context, articleRecord) (bool, error)
	RecordArticleView(context.Context, int64) (articleEngagement, error)
	RecordArticleLike(context.Context, int64) (articleEngagement, error)
}

type postgresArticleStore struct {
	pool *pgxpool.Pool
}

var errArticleNotFound = errors.New("article not found")
var errArticleSlugExists = errors.New("article slug already exists")

type articleEngagement struct {
	Views int `json:"views"`
	Likes int `json:"likes"`
}

const articleSelectFields = `
	p.id,
	p.slug,
	p.title,
	p.summary,
	p.content_markdown,
	p.series,
	p.read_time,
	p.views,
	p.likes,
	p.status,
	COALESCE(p.published_at::DATE::TEXT, ''),
	p.created_at,
	p.updated_at,
	COALESCE(category.name, ''),
	COALESCE(tag_list.tags, ARRAY[]::TEXT[])
`

const articleSelectFrom = `
	FROM posts p
	LEFT JOIN LATERAL (
		SELECT c.name
		FROM post_categories pc
		JOIN categories c ON c.id = pc.category_id
		WHERE pc.post_id = p.id
		ORDER BY c.name
		LIMIT 1
	) category ON TRUE
	LEFT JOIN LATERAL (
		SELECT ARRAY_AGG(t.name ORDER BY t.name) AS tags
		FROM post_tags pt
		JOIN tags t ON t.id = pt.tag_id
		WHERE pt.post_id = p.id
	) tag_list ON TRUE
`

type articleScanner interface {
	Scan(...any) error
}

func scanArticle(scanner articleScanner) (articleRecord, error) {
	var article articleRecord
	err := scanner.Scan(
		&article.ID,
		&article.Slug,
		&article.Title,
		&article.Summary,
		&article.Content,
		&article.Series,
		&article.ReadTime,
		&article.Views,
		&article.Likes,
		&article.Status,
		&article.Date,
		&article.CreatedAt,
		&article.UpdatedAt,
		&article.Category,
		&article.Tags,
	)
	if err != nil {
		return articleRecord{}, err
	}
	return article, nil
}

func (store postgresArticleStore) ListArticles(ctx context.Context, includeDrafts bool) ([]articleRecord, error) {
	query := `SELECT ` + articleSelectFields + articleSelectFrom
	if !includeDrafts {
		query += ` WHERE p.status = 'published'`
	}
	query += ` ORDER BY p.published_at DESC NULLS LAST, p.id DESC`

	rows, err := store.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list articles: %w", err)
	}
	defer rows.Close()

	articles := make([]articleRecord, 0)
	for rows.Next() {
		article, err := scanArticle(rows)
		if err != nil {
			return nil, fmt.Errorf("scan article: %w", err)
		}
		articles = append(articles, article)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate articles: %w", err)
	}
	return articles, nil
}

func (store postgresArticleStore) GetArticle(ctx context.Context, id int64, includeDrafts bool) (articleRecord, error) {
	query := `SELECT ` + articleSelectFields + articleSelectFrom + ` WHERE p.id = $1`
	if !includeDrafts {
		query += ` AND p.status = 'published'`
	}
	article, err := scanArticle(store.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return articleRecord{}, errArticleNotFound
	}
	if err != nil {
		return articleRecord{}, fmt.Errorf("get article: %w", err)
	}
	return article, nil
}

func (store postgresArticleStore) CreateArticle(ctx context.Context, article articleRecord) (articleRecord, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return articleRecord{}, fmt.Errorf("begin article transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	inserted, err := insertArticle(ctx, tx, &article, false)
	if err != nil {
		return articleRecord{}, err
	}
	if !inserted {
		return articleRecord{}, errArticleSlugExists
	}
	if err := tx.Commit(ctx); err != nil {
		return articleRecord{}, fmt.Errorf("commit article transaction: %w", err)
	}
	return article, nil
}

func (store postgresArticleStore) UpdateArticle(ctx context.Context, article articleRecord) (articleRecord, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return articleRecord{}, fmt.Errorf("begin article transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `
		UPDATE posts
		SET slug = $1,
			title = $2,
			summary = $3,
			content_markdown = $4,
			series = $5,
			read_time = $6,
			status = $7,
			published_at = $8::DATE,
			updated_at = NOW()
		WHERE id = $9
		RETURNING created_at, updated_at
	`, article.Slug, article.Title, article.Summary, article.Content, article.Series, article.ReadTime, article.Status, article.Date, article.ID).Scan(&article.CreatedAt, &article.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return articleRecord{}, errArticleNotFound
	}
	if err != nil {
		return articleRecord{}, fmt.Errorf("update article: %w", err)
	}
	if err := replaceArticleTaxonomy(ctx, tx, article.ID, article.Category, article.Tags); err != nil {
		return articleRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return articleRecord{}, fmt.Errorf("commit article update: %w", err)
	}
	return store.GetArticle(ctx, article.ID, true)
}

func (store postgresArticleStore) DeleteArticle(ctx context.Context, id int64) error {
	result, err := store.pool.Exec(ctx, `DELETE FROM posts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete article: %w", err)
	}
	if result.RowsAffected() == 0 {
		return errArticleNotFound
	}
	return nil
}

func (store postgresArticleStore) RecordArticleView(ctx context.Context, id int64) (articleEngagement, error) {
	return store.updateArticleEngagement(ctx, id, "views")
}

func (store postgresArticleStore) RecordArticleLike(ctx context.Context, id int64) (articleEngagement, error) {
	return store.updateArticleEngagement(ctx, id, "likes")
}

func (store postgresArticleStore) updateArticleEngagement(ctx context.Context, id int64, column string) (articleEngagement, error) {
	query := `UPDATE posts SET ` + column + ` = ` + column + ` + 1, updated_at = NOW()
		WHERE id = $1 AND status = 'published'
		RETURNING views, likes`
	var engagement articleEngagement
	if err := store.pool.QueryRow(ctx, query, id).Scan(&engagement.Views, &engagement.Likes); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return articleEngagement{}, errArticleNotFound
		}
		return articleEngagement{}, fmt.Errorf("record article engagement: %w", err)
	}
	return engagement, nil
}

func (store postgresArticleStore) SeedArticle(ctx context.Context, article articleRecord) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin article seed transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	inserted, err := insertArticle(ctx, tx, &article, true)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit article seed transaction: %w", err)
	}
	return inserted, nil
}

func insertArticle(ctx context.Context, tx pgx.Tx, article *articleRecord, ignoreConflict bool) (bool, error) {
	query := `
		INSERT INTO posts (slug, title, summary, content_markdown, series, read_time, views, likes, status, published_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::DATE)
	`
	if ignoreConflict {
		query += ` ON CONFLICT (slug) DO NOTHING`
	}
	query += ` RETURNING id, created_at, updated_at`

	err := tx.QueryRow(ctx, query, article.Slug, article.Title, article.Summary, article.Content, article.Series, article.ReadTime, article.Views, article.Likes, article.Status, article.Date).Scan(&article.ID, &article.CreatedAt, &article.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) && ignoreConflict {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("insert article: %w", err)
	}
	if err := replaceArticleTaxonomy(ctx, tx, article.ID, article.Category, article.Tags); err != nil {
		return false, err
	}
	return true, nil
}

func replaceArticleTaxonomy(ctx context.Context, tx pgx.Tx, articleID int64, category string, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM post_categories WHERE post_id = $1`, articleID); err != nil {
		return fmt.Errorf("clear article categories: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM post_tags WHERE post_id = $1`, articleID); err != nil {
		return fmt.Errorf("clear article tags: %w", err)
	}

	var categoryID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO categories (name, slug)
		VALUES ($1, $2)
		ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
		RETURNING id
	`, category, slugifyArticle(category)).Scan(&categoryID); err != nil {
		return fmt.Errorf("save article category: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO post_categories (post_id, category_id) VALUES ($1, $2)`, articleID, categoryID); err != nil {
		return fmt.Errorf("link article category: %w", err)
	}

	for _, tag := range normalizeArticleTags(tags) {
		var tagID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO tags (name, slug)
			VALUES ($1, $2)
			ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
			RETURNING id
		`, tag, slugifyArticle(tag)).Scan(&tagID); err != nil {
			return fmt.Errorf("save article tag: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)`, articleID, tagID); err != nil {
			return fmt.Errorf("link article tag: %w", err)
		}
	}
	return nil
}

func ensureArticleTables(ctx context.Context, pool *pgxpool.Pool) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS posts (
			id BIGSERIAL PRIMARY KEY,
			slug TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			content_markdown TEXT NOT NULL DEFAULT '',
			content_html TEXT NOT NULL DEFAULT '',
			cover_url TEXT NOT NULL DEFAULT '',
			series TEXT NOT NULL DEFAULT '',
			read_time TEXT NOT NULL DEFAULT '',
			views INTEGER NOT NULL DEFAULT 0,
			likes INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
			published_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`ALTER TABLE posts ADD COLUMN IF NOT EXISTS series TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE posts ADD COLUMN IF NOT EXISTS read_time TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE posts ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0`,
		`CREATE INDEX IF NOT EXISTS posts_status_published_at_idx ON posts (status, published_at DESC)`,
		`CREATE TABLE IF NOT EXISTS categories (
			id BIGSERIAL PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			slug TEXT NOT NULL UNIQUE
		)`,
		`CREATE TABLE IF NOT EXISTS tags (
			id BIGSERIAL PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			slug TEXT NOT NULL UNIQUE
		)`,
		`CREATE TABLE IF NOT EXISTS post_categories (
			post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
			category_id BIGINT NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
			PRIMARY KEY (post_id, category_id)
		)`,
		`CREATE TABLE IF NOT EXISTS post_tags (
			post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
			tag_id BIGINT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
			PRIMARY KEY (post_id, tag_id)
		)`,
		`CREATE TABLE IF NOT EXISTS app_migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func migrateLegacyArticles(ctx context.Context, pool *pgxpool.Pool, store articleStore) error {
	const migrationName = "20261016_import_legacy_frontend_articles"
	var applied bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM app_migrations WHERE name = $1)`, migrationName).Scan(&applied); err != nil {
		return fmt.Errorf("check article migration: %w", err)
	}
	if applied {
		return nil
	}

	for _, article := range legacyArticles() {
		if _, err := store.SeedArticle(ctx, article); err != nil {
			return fmt.Errorf("seed legacy article %q: %w", article.Title, err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO app_migrations (name) VALUES ($1)`, migrationName); err != nil {
		return fmt.Errorf("record article migration: %w", err)
	}
	return nil
}

type articlePayload struct {
	Slug     string   `json:"slug"`
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Content  string   `json:"content"`
	Category string   `json:"category"`
	Series   string   `json:"series"`
	Tags     []string `json:"tags"`
	Date     string   `json:"date"`
	ReadTime string   `json:"readTime"`
	Status   string   `json:"status"`
}

func articleFromPayload(payload articlePayload) (articleRecord, error) {
	article := articleRecord{
		Slug:     strings.TrimSpace(payload.Slug),
		Title:    strings.TrimSpace(payload.Title),
		Summary:  strings.TrimSpace(payload.Summary),
		Content:  strings.TrimSpace(payload.Content),
		Category: strings.TrimSpace(payload.Category),
		Series:   strings.TrimSpace(payload.Series),
		Tags:     normalizeArticleTags(payload.Tags),
		Date:     strings.TrimSpace(payload.Date),
		ReadTime: strings.TrimSpace(payload.ReadTime),
		Status:   strings.TrimSpace(payload.Status),
	}
	if article.Title == "" || article.Content == "" || article.Category == "" {
		return articleRecord{}, errors.New("title, category, and content are required")
	}
	if article.Summary == "" {
		article.Summary = article.Title
	}
	if article.Slug == "" {
		article.Slug = slugifyArticle(article.Title)
	}
	if article.Slug == "" {
		return articleRecord{}, errors.New("a valid title or slug is required")
	}
	if article.Date == "" {
		article.Date = time.Now().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", article.Date); err != nil {
		return articleRecord{}, errors.New("date must use YYYY-MM-DD")
	}
	if article.Status == "" {
		article.Status = "published"
	}
	if article.Status != "draft" && article.Status != "published" {
		return articleRecord{}, errors.New("status must be draft or published")
	}
	return article, nil
}

func articlesHandler(store articleStore, includeDrafts bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		articles, err := store.ListArticles(c.Request.Context(), includeDrafts)
		if err != nil {
			log.Printf("list articles: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "articles are temporarily unavailable"})
			return
		}
		c.JSON(http.StatusOK, articles)
	}
}

func articleHandler(store articleStore, includeDrafts bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article id"})
			return
		}
		article, err := store.GetArticle(c.Request.Context(), id, includeDrafts)
		if errors.Is(err, errArticleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
			return
		}
		if err != nil {
			log.Printf("get article: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "article is temporarily unavailable"})
			return
		}
		c.JSON(http.StatusOK, article)
	}
}

func articleCreateHandler(store articleStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload articlePayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article payload"})
			return
		}
		article, err := articleFromPayload(payload)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		saved, err := store.CreateArticle(c.Request.Context(), article)
		if errors.Is(err, errArticleSlugExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "an article with this slug already exists"})
			return
		}
		if err != nil {
			log.Printf("create article: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "article could not be saved"})
			return
		}
		c.JSON(http.StatusCreated, saved)
	}
}

func articleUpdateHandler(store articleStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article id"})
			return
		}
		var payload articlePayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article payload"})
			return
		}
		article, err := articleFromPayload(payload)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		article.ID = id
		saved, err := store.UpdateArticle(c.Request.Context(), article)
		if errors.Is(err, errArticleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
			return
		}
		if errors.Is(err, errArticleSlugExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "an article with this slug already exists"})
			return
		}
		if err != nil {
			log.Printf("update article: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "article could not be updated"})
			return
		}
		c.JSON(http.StatusOK, saved)
	}
}

func articleDeleteHandler(store articleStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article id"})
			return
		}
		if err := store.DeleteArticle(c.Request.Context(), id); errors.Is(err, errArticleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
			return
		} else if err != nil {
			log.Printf("delete article: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "article could not be deleted"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func articleEngagementHandler(store articleStore, action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid article id"})
			return
		}

		var engagement articleEngagement
		if action == "view" {
			engagement, err = store.RecordArticleView(c.Request.Context(), id)
		} else {
			engagement, err = store.RecordArticleLike(c.Request.Context(), id)
		}
		if errors.Is(err, errArticleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
			return
		}
		if err != nil {
			log.Printf("record article %s: %v", action, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "article engagement could not be recorded"})
			return
		}
		c.JSON(http.StatusOK, engagement)
	}
}

func normalizeArticleTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" {
			continue
		}
		key := strings.ToLower(tag)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, tag)
	}
	return result
}

func slugifyArticle(value string) string {
	var result strings.Builder
	dashPending := false
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			if dashPending && result.Len() > 0 {
				result.WriteByte('-')
			}
			result.WriteRune(character)
			dashPending = false
			continue
		}
		if character == '-' || character == '_' || unicode.IsSpace(character) {
			dashPending = result.Len() > 0
		}
	}
	return strings.Trim(result.String(), "-")
}

func legacyArticles() []articleRecord {
	concurrency := strings.TrimSpace(`## 从共享状态开始

并发问题不是由线程数量本身造成的，而是由**共享状态**和**状态转换**共同决定的。

当多个线程同时读写同一份数据时，需要明确三件事：

1. 写入是否对其他线程可见
2. 操作之间是否允许重排
3. 复合操作是否具备原子性

## happens-before

` + "`" + `happens-before` + "`" + ` 不是执行时间上的先后，而是一条可见性与有序性的约束关系。

> 如果操作 A happens-before 操作 B，那么 A 的结果对 B 可见，且 A 的执行顺序排在 B 之前。

` + "```java" + `
private volatile boolean started;

void start() {
  started = true;
}

boolean isStarted() {
  return started;
}
` + "```" + `

` + "`" + `volatile` + "`" + ` 适合状态标记这类简单场景。涉及多个变量的一致性时，仍需要锁或更高层的并发工具。

## 选择工具

| 场景 | 优先选择 |
| --- | --- |
| 单个状态标记 | ` + "`" + `volatile` + "`" + ` |
| 单变量原子更新 | ` + "`" + `AtomicInteger` + "`" + ` |
| 多状态一致性 | ` + "`" + `synchronized` + "`" + ` 或 ` + "`" + `Lock` + "`" + ` |`)

	threadPool := strings.TrimSpace(`## 线程池不是任务队列

提交任务后，线程池会根据核心线程数、队列容量和最大线程数做出不同决策。

` + "```text" + `
提交任务 -> 核心线程 -> 工作队列 -> 非核心线程 -> 拒绝策略
` + "```" + `

## 观察重点

- 活跃线程数
- 队列长度
- 已完成任务数
- 拒绝次数`)

	completableFuture := strings.TrimSpace(`## 组合异步流程

` + "`" + `CompletableFuture` + "`" + ` 的价值在于把依赖关系直接表达为代码结构。

` + "```java" + `
CompletableFuture<String> profile = loadProfile(userId);
CompletableFuture<List<Order>> orders = loadOrders(userId);

return profile.thenCombine(orders, Result::new);
` + "```" + `

## 失败路径

异步链路需要和成功路径一样被设计：超时、降级和异常恢复应该靠近调用点。`)

	distributedLock := strings.TrimSpace(`## 锁住的不是代码

分布式锁真正保护的是对某个资源的写入资格。

## 租约与失效

租约到期并不意味着原持有者一定停止执行。网络延迟和进程暂停都会让“已经失效”的客户端继续发送请求。

> 因此，锁本身不足以证明写入仍然有效。

## Fencing Token

为每次持锁分配单调递增的 token，并让资源服务拒绝旧 token 的写入，才能在资源侧建立最终防线。`)

	return []articleRecord{
		{Slug: "java-memory-visibility-ordering", Title: "从可见性到有序性：并发编程的第一性原理", Category: "Java 并发编程", Series: "JUC 基础", Date: "2026-08-08", ReadTime: "12 min", Views: 1284, Summary: "梳理 happens-before、锁和原子性的关系，说明 Java 线程安全的核心约束。", Content: concurrency, Status: "published", Tags: []string{"Java", "并发", "JUC"}},
		{Slug: "java-thread-pool-lifecycle", Title: "一张图读懂 Java 线程池的生命周期", Category: "Java 并发编程", Series: "JUC 基础", Date: "2026-08-01", ReadTime: "9 min", Views: 967, Summary: "从任务提交到 Worker 退出，记录 ThreadPoolExecutor 最容易被忽略的状态变化。", Content: threadPool, Status: "published", Tags: []string{"Java", "线程池", "JUC"}},
		{Slug: "reliable-completable-future", Title: "用 CompletableFuture 编排一次可靠的异步流程", Category: "Java 并发编程", Series: "异步工具箱", Date: "2026-07-22", ReadTime: "15 min", Views: 742, Summary: "并行、超时、降级和异常恢复，组合成可以在生产环境里落地的异步代码。", Content: completableFuture, Status: "published", Tags: []string{"Java", "异步", "CompletableFuture"}},
		{Slug: "redis-distributed-lock-boundaries", Title: "从 Redis 分布式锁想到的几个边界问题", Category: "后端实践", Series: "系统设计", Date: "2026-07-14", ReadTime: "11 min", Views: 536, Summary: "锁住的到底是什么？从租约、时钟漂移到 fencing token，重新审视分布式锁。", Content: distributedLock, Status: "published", Tags: []string{"Redis", "分布式锁", "系统设计"}},
		{Slug: "concurrent-collections-tradeoffs", Title: "并发集合的取舍：从读写比例开始判断", Category: "Java 并发编程", Series: "JUC 基础", Date: "2026-07-05", ReadTime: "10 min", Views: 683, Summary: "比较 ConcurrentHashMap、CopyOnWriteArrayList 和阻塞队列的适用边界。", Content: concurrency, Status: "published", Tags: []string{"Java", "并发集合", "JUC"}},
		{Slug: "async-timeout-cancellation-cleanup", Title: "异步任务的超时、取消与资源回收", Category: "Java 并发编程", Series: "异步工具箱", Date: "2026-06-26", ReadTime: "8 min", Views: 451, Summary: "让超时不只是抛出异常，而是能够收敛任务、连接和下游资源。", Content: completableFuture, Status: "published", Tags: []string{"Java", "异步", "超时"}},
		{Slug: "production-deadlock-investigation", Title: "一次线上死锁排查的完整路径", Category: "Java 并发编程", Series: "JUC 基础", Date: "2026-06-18", ReadTime: "13 min", Views: 792, Summary: "从线程转储、锁等待图到复现策略，记录定位死锁时的关键观察点。", Content: concurrency, Status: "published", Tags: []string{"Java", "死锁", "故障排查"}},
		{Slug: "rate-limiter-protect-systems", Title: "限流器设计：保护系统，而不是拒绝用户", Category: "后端实践", Series: "系统设计", Date: "2026-06-09", ReadTime: "11 min", Views: 625, Summary: "围绕入口、队列和反馈设计限流策略，让系统在高压下仍然可预测。", Content: distributedLock, Status: "published", Tags: []string{"限流", "系统设计", "后端"}},
		{Slug: "idempotency-at-api-boundaries", Title: "幂等控制如何落在接口边界", Category: "后端实践", Series: "系统设计", Date: "2026-05-30", ReadTime: "9 min", Views: 418, Summary: "从请求标识、状态存储到重复提交，拆解接口幂等的实现要点。", Content: distributedLock, Status: "published", Tags: []string{"幂等", "接口设计", "后端"}},
		{Slug: "async-error-propagation-fallback", Title: "异步链路中的异常传播与降级", Category: "Java 并发编程", Series: "异步工具箱", Date: "2026-05-21", ReadTime: "14 min", Views: 574, Summary: "统一处理异常、超时和兜底结果，避免异步流程在边界处失控。", Content: completableFuture, Status: "published", Tags: []string{"Java", "异步", "降级"}},
	}
}

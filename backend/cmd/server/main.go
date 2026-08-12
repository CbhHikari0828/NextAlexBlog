package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	databaseURL := envOrDefault(
		"DATABASE_URL",
		"postgres://blog:blog_dev_password@localhost:55432/blog?sslmode=disable",
	)
	port := envOrDefault("BACKEND_PORT", "8090")

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

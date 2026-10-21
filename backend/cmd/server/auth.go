package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	adminSessionCookieName = "nextalex_admin_session"
	adminSessionCookiePath = "/api/admin"
	adminSessionDuration   = 12 * time.Hour
)

type adminAuthenticator struct {
	username      string
	password      string
	sessionSecret []byte
	cookieSecure  bool
	now           func() time.Time
}

type adminLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type adminSessionClaims struct {
	Username  string `json:"username"`
	ExpiresAt int64  `json:"expiresAt"`
}

func newAdminAuthenticatorFromEnvironment() (*adminAuthenticator, error) {
	cookieSecure, err := strconv.ParseBool(envOrDefault("ADMIN_COOKIE_SECURE", "false"))
	if err != nil {
		return nil, fmt.Errorf("parse ADMIN_COOKIE_SECURE: %w", err)
	}

	sessionSecret := []byte(os.Getenv("ADMIN_SESSION_SECRET"))
	if len(sessionSecret) == 0 {
		sessionSecret = make([]byte, 32)
		if _, err := rand.Read(sessionSecret); err != nil {
			return nil, fmt.Errorf("generate admin session secret: %w", err)
		}
		log.Printf("ADMIN_SESSION_SECRET is not configured; generated a temporary secret and existing admin sessions will expire when the backend restarts")
	}

	return &adminAuthenticator{
		username:      envOrDefault("ADMIN_USERNAME", "alexlee"),
		password:      envOrDefault("ADMIN_PASSWORD", "alexlee"),
		sessionSecret: sessionSecret,
		cookieSecure:  cookieSecure,
		now:           time.Now,
	}, nil
}

func adminLoginHandler(auth *adminAuthenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request adminLoginRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid login request"})
			return
		}

		usernameMatches := constantTimeStringEqual(request.Username, auth.username)
		passwordMatches := constantTimeStringEqual(request.Password, auth.password)
		if !usernameMatches || !passwordMatches {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}

		expiresAt := auth.now().Add(adminSessionDuration)
		token, err := auth.createSessionToken(expiresAt)
		if err != nil {
			log.Printf("create admin session: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to create admin session"})
			return
		}

		http.SetCookie(c.Writer, auth.sessionCookie(token, expiresAt, int(adminSessionDuration.Seconds())))
		c.JSON(http.StatusOK, gin.H{"authenticated": true, "username": auth.username})
	}
}

func adminSessionHandler(auth *adminAuthenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := auth.authenticateRequest(c.Request)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"authenticated": false})
			return
		}

		c.JSON(http.StatusOK, gin.H{"authenticated": true, "username": username})
	}
}

func adminLogoutHandler(auth *adminAuthenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		http.SetCookie(c.Writer, auth.sessionCookie("", time.Unix(1, 0), -1))
		c.JSON(http.StatusOK, gin.H{"authenticated": false})
	}
}

func adminAuthMiddleware(auth *adminAuthenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, ok := auth.authenticateRequest(c.Request)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}

		c.Set("adminUsername", username)
		c.Next()
	}
}

func (auth *adminAuthenticator) authenticateRequest(request *http.Request) (string, bool) {
	cookie, err := request.Cookie(adminSessionCookieName)
	if err != nil {
		return "", false
	}
	return auth.validateSessionToken(cookie.Value)
}

func (auth *adminAuthenticator) createSessionToken(expiresAt time.Time) (string, error) {
	claims, err := json.Marshal(adminSessionClaims{
		Username:  auth.username,
		ExpiresAt: expiresAt.Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("encode admin session claims: %w", err)
	}

	payload := base64.RawURLEncoding.EncodeToString(claims)
	signature := auth.signSessionPayload(payload)
	return payload + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (auth *adminAuthenticator) validateSessionToken(token string) (string, bool) {
	payload, encodedSignature, found := strings.Cut(token, ".")
	if !found || payload == "" || encodedSignature == "" {
		return "", false
	}

	signature, err := base64.RawURLEncoding.DecodeString(encodedSignature)
	if err != nil || !hmac.Equal(signature, auth.signSessionPayload(payload)) {
		return "", false
	}

	encodedClaims, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return "", false
	}
	var claims adminSessionClaims
	if err := json.Unmarshal(encodedClaims, &claims); err != nil {
		return "", false
	}
	if !constantTimeStringEqual(claims.Username, auth.username) || claims.ExpiresAt <= auth.now().Unix() {
		return "", false
	}
	return claims.Username, true
}

func (auth *adminAuthenticator) signSessionPayload(payload string) []byte {
	signature := hmac.New(sha256.New, auth.sessionSecret)
	_, _ = signature.Write([]byte(payload))
	return signature.Sum(nil)
}

func (auth *adminAuthenticator) sessionCookie(value string, expiresAt time.Time, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     adminSessionCookieName,
		Value:    value,
		Path:     adminSessionCookiePath,
		Expires:  expiresAt.UTC(),
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   auth.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	}
}

func constantTimeStringEqual(left string, right string) bool {
	leftDigest := sha256.Sum256([]byte(left))
	rightDigest := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftDigest[:], rightDigest[:]) == 1
}

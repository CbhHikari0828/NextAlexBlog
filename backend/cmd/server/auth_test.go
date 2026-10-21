package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

var adminAuthTestTime = time.Date(2026, time.October, 16, 12, 0, 0, 0, time.UTC)

func newTestAdminAuthenticator(cookieSecure bool) *adminAuthenticator {
	return &adminAuthenticator{
		username:      "alexlee",
		password:      "alexlee",
		sessionSecret: []byte("test-admin-session-secret-with-enough-entropy"),
		cookieSecure:  cookieSecure,
		now: func() time.Time {
			return adminAuthTestTime
		},
	}
}

func newTestAdminRouter(auth *adminAuthenticator) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/admin/login", adminLoginHandler(auth))
	router.GET("/api/admin/session", adminSessionHandler(auth))
	router.POST("/api/admin/logout", adminLogoutHandler(auth))
	admin := router.Group("/api/admin")
	admin.Use(adminAuthMiddleware(auth))
	admin.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	router.GET("/api/public", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return router
}

func TestAdminLoginCreatesSessionCookieAndSessionCanBeRead(t *testing.T) {
	auth := newTestAdminAuthenticator(true)
	router := newTestAdminRouter(auth)

	loginResponse := httptest.NewRecorder()
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{"username":"alexlee","password":"alexlee"}`))
	loginRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(loginResponse, loginRequest)

	if loginResponse.Code != http.StatusOK {
		t.Fatalf("POST /api/admin/login returned %d: %s", loginResponse.Code, loginResponse.Body.String())
	}
	cookies := loginResponse.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login returned %d cookies, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != adminSessionCookieName {
		t.Errorf("cookie name = %q, want %q", cookie.Name, adminSessionCookieName)
	}
	if cookie.Path != adminSessionCookiePath {
		t.Errorf("cookie path = %q, want %q", cookie.Path, adminSessionCookiePath)
	}
	if !cookie.HttpOnly {
		t.Error("session cookie is not HttpOnly")
	}
	if !cookie.Secure {
		t.Error("session cookie is not Secure when ADMIN_COOKIE_SECURE is enabled")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("cookie SameSite = %v, want Lax", cookie.SameSite)
	}
	if cookie.MaxAge != int(adminSessionDuration.Seconds()) {
		t.Errorf("cookie MaxAge = %d, want %d", cookie.MaxAge, int(adminSessionDuration.Seconds()))
	}
	if !cookie.Expires.Equal(adminAuthTestTime.Add(adminSessionDuration)) {
		t.Errorf("cookie expiry = %v, want %v", cookie.Expires, adminAuthTestTime.Add(adminSessionDuration))
	}

	sessionResponse := httptest.NewRecorder()
	sessionRequest := httptest.NewRequest(http.MethodGet, "/api/admin/session", nil)
	sessionRequest.AddCookie(cookie)
	router.ServeHTTP(sessionResponse, sessionRequest)
	if sessionResponse.Code != http.StatusOK {
		t.Fatalf("GET /api/admin/session returned %d: %s", sessionResponse.Code, sessionResponse.Body.String())
	}
	var session struct {
		Authenticated bool   `json:"authenticated"`
		Username      string `json:"username"`
	}
	if err := json.Unmarshal(sessionResponse.Body.Bytes(), &session); err != nil {
		t.Fatalf("decode session response: %v", err)
	}
	if !session.Authenticated || session.Username != "alexlee" {
		t.Errorf("session response = %#v", session)
	}
}

func TestAdminLoginRejectsIncorrectCredentials(t *testing.T) {
	auth := newTestAdminAuthenticator(false)
	router := newTestAdminRouter(auth)
	tests := []struct {
		name string
		body string
	}{
		{name: "wrong username", body: `{"username":"someone","password":"alexlee"}`},
		{name: "wrong password", body: `{"username":"alexlee","password":"wrong"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)

			if response.Code != http.StatusUnauthorized {
				t.Fatalf("login returned %d, want %d", response.Code, http.StatusUnauthorized)
			}
			if len(response.Result().Cookies()) != 0 {
				t.Fatal("failed login unexpectedly returned a cookie")
			}
		})
	}
}

func TestAdminSessionRejectsMissingTamperedAndExpiredCookies(t *testing.T) {
	auth := newTestAdminAuthenticator(false)
	router := newTestAdminRouter(auth)
	validToken, err := auth.createSessionToken(adminAuthTestTime.Add(adminSessionDuration))
	if err != nil {
		t.Fatalf("create valid session token: %v", err)
	}
	tamperedToken := validToken[:len(validToken)-1] + "A"
	if strings.HasSuffix(validToken, "A") {
		tamperedToken = validToken[:len(validToken)-1] + "B"
	}
	expiredToken, err := auth.createSessionToken(adminAuthTestTime.Add(-time.Second))
	if err != nil {
		t.Fatalf("create expired session token: %v", err)
	}

	tests := []struct {
		name  string
		token string
	}{
		{name: "missing"},
		{name: "tampered", token: tamperedToken},
		{name: "expired", token: expiredToken},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/admin/session", nil)
			if test.token != "" {
				request.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: test.token})
			}
			router.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("session returned %d, want %d", response.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestAdminAuthMiddlewareProtectsOnlyAdminGroup(t *testing.T) {
	auth := newTestAdminAuthenticator(false)
	router := newTestAdminRouter(auth)

	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, httptest.NewRequest(http.MethodGet, "/api/public", nil))
	if publicResponse.Code != http.StatusOK {
		t.Fatalf("public route returned %d, want %d", publicResponse.Code, http.StatusOK)
	}

	unauthorizedResponse := httptest.NewRecorder()
	router.ServeHTTP(unauthorizedResponse, httptest.NewRequest(http.MethodGet, "/api/admin/protected", nil))
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("protected route without cookie returned %d, want %d", unauthorizedResponse.Code, http.StatusUnauthorized)
	}

	token, err := auth.createSessionToken(adminAuthTestTime.Add(adminSessionDuration))
	if err != nil {
		t.Fatalf("create session token: %v", err)
	}
	authorizedResponse := httptest.NewRecorder()
	authorizedRequest := httptest.NewRequest(http.MethodGet, "/api/admin/protected", nil)
	authorizedRequest.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: token})
	router.ServeHTTP(authorizedResponse, authorizedRequest)
	if authorizedResponse.Code != http.StatusOK {
		t.Fatalf("protected route with cookie returned %d: %s", authorizedResponse.Code, authorizedResponse.Body.String())
	}
}

func TestAdminLogoutClearsSessionCookie(t *testing.T) {
	auth := newTestAdminAuthenticator(true)
	router := newTestAdminRouter(auth)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/logout", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("POST /api/admin/logout returned %d: %s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("logout returned %d cookies, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != adminSessionCookieName || cookie.Value != "" || cookie.MaxAge >= 0 {
		t.Errorf("logout cookie was not cleared: %#v", cookie)
	}
	if cookie.Path != adminSessionCookiePath || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("logout cookie attributes do not match the session cookie: %#v", cookie)
	}
}

func TestAdminAuthenticatorDefaultsToAlexlee(t *testing.T) {
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("ADMIN_SESSION_SECRET", "test-session-secret")
	t.Setenv("ADMIN_COOKIE_SECURE", "false")

	auth, err := newAdminAuthenticatorFromEnvironment()
	if err != nil {
		t.Fatalf("create authenticator: %v", err)
	}
	if auth.username != "alexlee" || auth.password != "alexlee" {
		t.Errorf("default credentials = %q/%q, want alexlee/alexlee", auth.username, auth.password)
	}
}

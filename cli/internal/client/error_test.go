package client

import (
	"strings"
	"testing"
)

// stderr carries two lines for a failed command and they have distinct jobs:
//
//	error: <what failed>     — owned by APIError.Error()
//	hint:  <what to do>      — owned by hintFor() in cmd/bk/main.go
//
// APIError.Error() used to append Suggestion too, so every server suggestion
// was printed twice — the double-print SilenceErrors exists to prevent, on the
// channel agents parse. Phase 4 made it routine traffic (app_access_denied),
// Phase 5 fixed it. These assert the split holds.
func TestAPIErrorDoesNotRestateTheSuggestion(t *testing.T) {
	e := &APIError{
		Status:     403,
		ErrorMsg:   "you do not have access to the issues app in this workspace",
		Suggestion: "ask a workspace owner to grant you access with `bk app access grant`",
	}

	got := e.Error()
	if strings.Contains(got, e.Suggestion) {
		t.Fatalf("APIError.Error() = %q; it restates the suggestion, which hintFor() "+
			"also prints as the `hint:` line — one fact, two lines", got)
	}
	// It must still say what failed, and with the status an agent branches on.
	if !strings.Contains(got, e.ErrorMsg) || !strings.Contains(got, "403") {
		t.Fatalf("APIError.Error() = %q; want the message and the status", got)
	}
}

// Details is part of WHAT failed (which field, and why), not advice about it, so
// it stays. Losing it would push validation reasons off stderr entirely.
func TestAPIErrorKeepsDetails(t *testing.T) {
	e := &APIError{Status: 400, ErrorMsg: "validation failed", Details: "title: required"}
	got := e.Error()
	if !strings.Contains(got, "title: required") {
		t.Fatalf("APIError.Error() = %q; want it to carry Details", got)
	}
}

// Both set: the suggestion is still the hint line's alone.
func TestAPIErrorWithBothPrefersDetails(t *testing.T) {
	e := &APIError{
		Status:     400,
		ErrorMsg:   "validation failed",
		Details:    "status: must be one of todo, in_progress, done",
		Suggestion: "run `bk meta` for the current status values",
	}
	got := e.Error()
	if !strings.Contains(got, "status: must be one of") {
		t.Fatalf("APIError.Error() = %q; want Details", got)
	}
	if strings.Contains(got, e.Suggestion) {
		t.Fatalf("APIError.Error() = %q; still restates the suggestion", got)
	}
}

// ---------------------------------------------------------------------------
// A 404 FROM A HOST THAT HAS NO ROUTE THERE
// ---------------------------------------------------------------------------
// `do` used to set the error message to the whole response body. Against a
// Next.js deployment with no route file that body is an HTML DOCUMENT, so
// `bk workspace list` through the sales host printed roughly thirty lines of
// markup to stderr — against the one contract the CLI has for failures: every
// failure is a non-zero exit with ONE line on stderr.
//
// Found in Phase 10 by running the north-star script from a sales login, where
// 47 of the 54 platform routes were unmounted. Most are mounted now, but an app
// serving a SUBSET is permanent and legitimate (D-36) — so this stops being a
// build-out symptom and becomes the steady state, which is why it is a typed
// error with a recovery rather than a nicer string.
//
// The body below is the real shape: what `next dev` returns for an unknown
// /api path, truncated. Anything that starts with markup must be treated the
// same way, whatever else is in it.
func TestNotServedErrorReplacesAnHTMLBody(t *testing.T) {
	body := []byte(`<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>` +
		`<title>404: This page could not be found.</title></head><body>` +
		strings.Repeat(`<script src="/_next/static/chunks/whatever.js"></script>`, 20) +
		`</body></html>`)

	if !looksLikeMarkup(body) {
		t.Fatal("looksLikeMarkup did not recognise a Next.js 404 page")
	}

	e := &NotServedError{App: "sales", BaseURL: "http://127.0.0.1:3100", Path: "/api/workspaces", Status: 404}
	got := e.Error()

	// ONE line. This is the assertion the defect would have failed.
	if strings.Contains(got, "\n") {
		t.Fatalf("NotServedError.Error() spans multiple lines:\n%s", got)
	}
	if len(got) > 120 {
		t.Fatalf("NotServedError.Error() is %d chars; stderr gets one readable line:\n%s", len(got), got)
	}
	// It must name WHO did not serve it and WHAT, or the reader cannot act.
	for _, want := range []string{"sales", "/api/workspaces", "404"} {
		if !strings.Contains(got, want) {
			t.Fatalf("NotServedError.Error() = %q; missing %q", got, want)
		}
	}
	// And it must not carry any of the body it replaced.
	if strings.Contains(got, "<") || strings.Contains(got, "_next") {
		t.Fatalf("NotServedError.Error() still contains markup: %q", got)
	}
}

// A JSON error body is NOT a NotServedError — it came from apiHandler and its
// message is the one the server chose. Without this, "replace the body" could be
// implemented as "always replace the body", and every real API error would lose
// its text while every assertion above still passed.
func TestJSONErrorBodiesAreNotTreatedAsUnserved(t *testing.T) {
	for _, body := range [][]byte{
		[]byte(`{"error":"prospect not found","suggestion":"run bk sales prospect list"}`),
		[]byte(`{"error":"query_too_short"}`),
	} {
		if looksLikeMarkup(body) {
			t.Fatalf("looksLikeMarkup(%q) = true; a JSON error body is an API answer", body)
		}
	}
}

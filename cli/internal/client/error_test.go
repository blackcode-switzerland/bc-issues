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

package commands

import (
	"strings"
	"testing"
)

// The `routes` annotation is only useful if it can't silently rot. This is the
// half of the guardrail that lives in Go: every leaf command must DECLARE what
// it calls (or declare "none"). The other half — that the declarations match
// reality — lives in lib/cli-parity.test.ts, which diffs `bk __routes` against
// app/api/**.
func TestEveryLeafCommandDeclaresItsRoutes(t *testing.T) {
	_, missing := CollectRoutes(NewRoot())
	if len(missing) > 0 {
		t.Fatalf(
			"these leaf commands have no `routes` annotation:\n  %s\n\n"+
				"Add Annotations: map[string]string{\"routes\": \"GET /api/…\"} to each, "+
				"or \"none\" if the command makes no HTTP call.",
			strings.Join(missing, "\n  "))
	}
}

// Declarations must be well-formed, or the parity test compares garbage.
func TestRouteDeclarationsAreWellFormed(t *testing.T) {
	entries, _ := CollectRoutes(NewRoot())
	if len(entries) == 0 {
		t.Fatal("no routes collected — the annotation walk is broken")
	}
	valid := map[string]bool{"GET": true, "POST": true, "PATCH": true, "PUT": true, "DELETE": true}
	for _, e := range entries {
		if !valid[e.Method] {
			t.Errorf("%s: unknown HTTP method %q", e.Command, e.Method)
		}
		if !strings.HasPrefix(e.Path, "/api/") {
			t.Errorf("%s: route %q must start with /api/", e.Command, e.Path)
		}
		if strings.Contains(e.Path, "[") || strings.Contains(e.Path, "]") {
			t.Errorf("%s: route %q must use {param}, not [param]", e.Command, e.Path)
		}
	}
}

// `bk guide` is what an agent runs when everything else is failing, so it must
// work with no config, no token and no network. A regression here is silent
// otherwise — the command would only break for the users who need it most.
func TestGuideCommandIsOfflineAndUnauthenticated(t *testing.T) {
	guideCmd, _, err := NewRoot().Find([]string{"guide"})
	if err != nil {
		t.Fatalf("guide command not registered: %v", err)
	}
	if got := guideCmd.Annotations["routes"]; got != "none" {
		t.Errorf("bk guide declares routes %q — it must make no HTTP call at all", got)
	}
}

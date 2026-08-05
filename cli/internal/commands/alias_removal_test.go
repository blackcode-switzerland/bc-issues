package commands

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
)

// The pre-1.10.0 spellings are GONE as of 1.12.0, on the two-minor schedule
// promised when they were introduced.
//
// This file used to be `aliases_test.go`, and it asserted the opposite: that
// every old spelling resolved to the same command as its namespaced form. That
// test did its job for two releases. Removing the aliases without replacing it
// would have left the removal unguarded, so it is inverted rather than deleted —
// the property that matters simply changed from "the alias works" to "the
// removal names its own exit".
//
// That distinction is the whole point. `bk issue create` failing is fine. `bk
// issue create` failing with nothing but `unknown command "issue" for "bk"` is
// an agent that stops mid-task, having been given no way forward. The
// deprecations.go rows deliberately outlive the aliases by one release so
// hintFor() can turn the failure into a recovery.

// aliasedNouns are the six spellings that were removed. Read from the app's own
// noun list rather than typed out, so a noun added later cannot be missed.
func aliasedNouns(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, noun := range issues.LegacyTopLevel() {
		out = append(out, noun.Name())
	}
	if len(out) < 6 {
		t.Fatalf("only %d nouns discovered — the list looks empty, which would make "+
			"every assertion below vacuous", len(out))
	}
	return out
}

// The old spellings must NOT resolve any more. If one still does, the alias
// removal was incomplete and the changelog is lying about what 1.12.0 did.
func TestOldSpellingsNoLongerResolve(t *testing.T) {
	root := NewRoot()
	for _, noun := range aliasedNouns(t) {
		t.Run(noun, func(t *testing.T) {
			if _, _, err := root.Find([]string{noun}); err == nil {
				t.Fatalf("`bk %s` still resolves — the 1.12.0 alias removal is incomplete", noun)
			}
			// …while the namespaced form obviously still must.
			if _, _, err := root.Find([]string{issues.Slug, noun}); err != nil {
				t.Fatalf("`bk %s %s` does not resolve: %v", issues.Slug, noun, err)
			}
		})
	}
}

// THE ONE THAT MATTERS. Every removed spelling must still have a deprecations.go
// row, so the failure carries the new spelling instead of dead-ending.
//
// Without this, removing an alias and forgetting its hint looks identical to a
// clean removal — right up until an agent runs the old command next week.
func TestRemovedSpellingsStillCarryAHint(t *testing.T) {
	for _, noun := range aliasedNouns(t) {
		t.Run(noun, func(t *testing.T) {
			// THE EXACT STRING COBRA EMITS, including the trailing argv — not a
			// hand-written approximation. `bk issue list` produces
			// `unknown command "issue list" for "bk"`, and asserting the
			// single-word form instead is how the first version of this test
			// passed while the real binary handed `bk issue list` the generic
			// fallback hint. Verified against the built binary.
			for _, errMsg := range []string{
				`unknown command "` + noun + `" for "bk"`,
				`unknown command "` + noun + ` list" for "bk"`,
				`unknown command "` + noun + ` create --title x" for "bk"`,
			} {
				if got := DeprecationHint(errMsg); got == "" {
					t.Fatalf("no hint for %s", errMsg)
				}
			}
			hint := DeprecationHint(`unknown command "` + noun + ` list" for "bk"`)
			if hint == "" {
				t.Fatalf("`bk %s` was removed but has no deprecations.go row — an agent "+
					"running it gets `unknown command` and nothing to act on", noun)
			}
			// The hint has to name the replacement, not merely exist.
			want := "bk " + issues.Slug + " " + noun
			if !strings.Contains(hint, want) {
				t.Errorf("the hint for `bk %s` does not name %q:\n  %s", noun, want, hint)
			}
		})
	}
}

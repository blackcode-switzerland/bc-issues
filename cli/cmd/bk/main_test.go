package main

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// THE END-TO-END HALF OF THE DEPRECATION GUARD.
//
// internal/commands/appverbs_test.go asserts the deprecations table has a row
// for every removed spelling. That is necessary and NOT sufficient: the table is
// only reachable through hintFor(), and hintFor() lives here, in package main,
// which had no test at all. Delete the DeprecationHint call from hintFor() and
// every assertion over there still passes while the binary hands an agent the
// generic "may have been renamed" line.
//
// That is CLAUDE.md finding #8's shape — a guard written by someone who knew the
// rule — and docs/sales-app-plan.md D-26's third step: inject the regression and
// watch the check again. Verified by doing exactly that; see the commit message.
//
// The error is not hand-written here either. It comes from Execute() on the real
// command tree, so cobra's actual wording — which is what DeprecationHint has to
// parse — is part of what is being tested.
func runBK(t *testing.T, argv ...string) error {
	t.Helper()
	root := commands.NewRoot()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	root.SetArgs(argv)
	return root.Execute()
}

// The removed bare spellings (D-11), and the app-qualified form each must name.
var removedBareVerbs = map[string]string{
	"upload":  "bk issues upload",
	"storage": "bk issues storage",
	"trash":   "bk issues trash",
	"label":   "bk issues label",
}

func TestRemovedBareVerbsFailWithARecoverableHint(t *testing.T) {
	for verb, replacement := range removedBareVerbs {
		t.Run(verb, func(t *testing.T) {
			// Realistic argv, not the bare word: `bk upload x.pdf`, `bk trash list`.
			err := runBK(t, verb, "some-argument")
			if err == nil {
				t.Fatalf("`bk %s some-argument` succeeded — a removed spelling must exit "+
					"non-zero, not print help and exit 0", verb)
			}
			if got := classify(err); got != exitUsage {
				t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
			}
			hint := hintFor(err)
			if hint == "" {
				t.Fatalf("no hint for `bk %s` — the run dead-ends here: %v", verb, err)
			}
			if !strings.Contains(hint, replacement) {
				t.Errorf("`bk %s` failed with %q and hint %q — the hint must name %q, "+
					"or the agent has nothing to retry with",
					verb, err, hint, replacement)
			}
		})
	}
}

// The app-qualified spellings must be the ones that WORK. Without this, the test
// above would pass just as happily if the verbs had been deleted outright.
//
// Each runs a LEAF and requires the failure to be `not configured` — the auth
// check, which sits after the command resolved and parsed its arguments. Two
// weaker versions were tried first and both were inert:
//
//   - `root.Find([]string{"issues", "upload"})` returns no error when `upload`
//     does not exist; cobra only reports an unknown subcommand at the root.
//   - `bk issues upload --help` prints the GROUP's help and exits 0 for the same
//     reason.
//
// Both passed with the entire tier unmounted. BK_CONFIG_DIR points at an empty
// temp dir so the assertion cannot depend on the machine running it — and so no
// test ever reaches a real deployment with real credentials.
func TestAppQualifiedVerbsReachTheAuthCheck(t *testing.T) {
	leaf := map[string][]string{
		"upload":  {"issues", "upload", "some-file.pdf"},
		"storage": {"issues", "storage", "list"},
		"trash":   {"issues", "trash", "list"},
		"label":   {"issues", "label", "list"},
	}
	for verb, argv := range leaf {
		t.Run(verb, func(t *testing.T) {
			t.Setenv("BK_CONFIG_DIR", t.TempDir())
			err := runBK(t, argv...)
			if !errors.Is(err, config.ErrNotConfigured) {
				t.Fatalf("`bk %s` failed with %v; want %v — anything else means the command "+
					"did not resolve", strings.Join(argv, " "), err, config.ErrNotConfigured)
			}
			if got := classify(err); got != exitAuth {
				t.Errorf("exit code = %d, want %d (auth)", got, exitAuth)
			}
		})
	}
}

// A hint that fires for everything is a hint that says nothing. An unknown
// command with no deprecation row must get the generic advice, not another
// verb's migration note.
func TestUnrelatedUnknownCommandGetsNoNamedHint(t *testing.T) {
	err := runBK(t, "definitely-not-a-command")
	if err == nil {
		t.Fatal("an unknown command must fail")
	}
	hint := hintFor(err)
	for _, replacement := range removedBareVerbs {
		if strings.Contains(hint, replacement) {
			t.Errorf("an unrelated unknown command was told to run %q:\n  %s", replacement, hint)
		}
	}
	if !strings.Contains(hint, "renamed or removed") {
		t.Errorf("expected the generic recovery advice, got %q", hint)
	}
}

// hintFor must keep preferring the server's own suggestion where there is one —
// asserted because the deprecation branch sits in the same function and a rewrite
// there is exactly where this would be lost.
func TestHintForPrefersNothingOverNoise(t *testing.T) {
	if got := hintFor(errors.New("some runtime failure")); got != "" {
		t.Errorf("a plain runtime error should carry no hint, got %q", got)
	}
}

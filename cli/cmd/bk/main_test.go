package main

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
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
//
// `storage` is deliberately ABSENT: D-28 kept it bare, in the cross-app tier. Its
// one moved subcommand is covered by TestRemovedStorageAttachmentsIsRedirected
// below, which is a different shape — a group that still exists, missing a
// subcommand that does not.
var removedBareVerbs = map[string]string{
	"upload": "bk issues upload",
	"trash":  "bk issues trash",
	"label":  "bk issues label",
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
		"upload": {"issues", "upload", "some-file.pdf"},
		"trash":  {"issues", "trash", "list"},
		"label":  {"issues", "label", "list"},
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

// `bk storage attachments` is the one spelling D-28 removed, and it fails
// differently from the four verbs above: `bk storage` still EXISTS, so the error
// comes from rejectUnknownSubcommands' RunE and names the group
// (`… for "bk storage"`), not the root. DeprecationHint has to match on
// `<parent> <sub>` for this one, and that lookup had no test until now.
func TestRemovedStorageAttachmentsIsRedirected(t *testing.T) {
	err := runBK(t, "storage", "attachments")
	if err == nil {
		t.Fatal("`bk storage attachments` succeeded — it was removed in D-28")
	}
	if got := classify(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
	}
	hint := hintFor(err)
	if !strings.Contains(hint, "bk issues attachment list") {
		t.Errorf("`bk storage attachments` failed with %q and hint %q — it must name "+
			"`bk issues attachment list`", err, hint)
	}
}

// …and the verb it hangs off must still work bare. Without this, the test above
// would pass just as well if `bk storage` had been deleted entirely, which is
// the opposite of what D-28 decided.
func TestStorageStaysBare(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	err := runBK(t, "storage", "list")
	if !errors.Is(err, config.ErrNotConfigured) {
		t.Fatalf("`bk storage list` failed with %v; want %v — storage is cross-app and "+
			"stays bare (D-28)", err, config.ErrNotConfigured)
	}
}

// The SAME user mistake must exit the same code whether the binary catches it or
// the server does.
//
// `bk sales prospect delete --confirm <wrong name>` is pre-checked locally: the
// binary fetches the record, compares, and returns an error worded to contain
// "required", which classify() maps to 2. If the pre-check is raced or skipped,
// the server answers 409 `confirm_mismatch`. Until 2026-08-07 that had no branch
// in classify() and exited 1 — one condition, two exit codes, decided by a race
// the caller cannot see. An agent branching on the code cannot write one
// recovery for that.
//
// The general rule: a pre-check in the binary must exit the same code the server
// would. This asserts BOTH halves, because asserting only the 409 would pass
// against a local guard that had drifted to some third code.
func TestServerConflictAndLocalPrecheckAgree(t *testing.T) {
	serverSide := classify(&client.APIError{Status: 409, ErrorMsg: "--confirm \"acme\" does not name prospect #7"})
	localSide := classify(errors.New(
		`--confirm is required to match prospect #7, which is "Acme SA" — got "acme"; nothing was deleted`))

	if serverSide != exitUsage {
		t.Errorf("a 409 from the server exits %d, want %d (usage)", serverSide, exitUsage)
	}
	if localSide != exitUsage {
		t.Errorf("the binary's local --confirm guard exits %d, want %d (usage)", localSide, exitUsage)
	}
	if serverSide != localSide {
		t.Errorf(
			"the same --confirm mistake exits %d when the server catches it and %d when the "+
				"binary does. One condition, two exit codes: an agent cannot write one recovery.",
			serverSide, localSide)
	}
}

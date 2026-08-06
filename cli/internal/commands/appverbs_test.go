package commands

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/spf13/cobra"
)

// D-11: `upload`, `storage`, `trash` and `label` are APP-OWNED — they are
// spelled `bk <app> <verb>` and there is no bare form.
//
// The properties below are what "the tier is visible in the command itself"
// actually means, asserted rather than described. The end-to-end half — that the
// removed spelling still hands an agent its replacement — is in
// cmd/bk/main_test.go, because hintFor() lives there and testing DeprecationHint
// alone would pass with hintFor() never calling it. That is the shape of
// CLAUDE.md finding #8, and it was found in this repo once already.

// appOwnedVerbs is the tier, in the order an app group lists them. Read from the
// shared constructor rather than typed out, so a fifth verb added there cannot
// be missed here.
func appOwnedVerbNames(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, c := range appverbs.New(appverbs.Config{App: "probe"}).All() {
		out = append(out, c.Name())
	}
	if len(out) < 4 {
		t.Fatalf("only %d app-owned verbs discovered — an empty list would make every "+
			"assertion below vacuous", len(out))
	}
	return out
}

// The bare spellings must be gone. A bare `bk upload` that still resolved would
// have to pick an app, and picking one silently is the accident D-11 removes.
//
// BOTH directions are asserted on the RESOLVED COMMAND, never on Find's error.
// Find returns no error for an unknown subcommand of a group — cobra's
// legacyArgs only complains at the root — so `Find([]string{"issues",
// "upload"})` succeeds, handing back the `issues` group itself, whether or not
// `upload` exists. The first draft of this test checked the error and passed
// with the whole tier unmounted; the mount was deleted to find that out.
func TestAppOwnedVerbsHaveNoBareSpelling(t *testing.T) {
	root := NewRoot()
	for _, verb := range appOwnedVerbNames(t) {
		t.Run(verb, func(t *testing.T) {
			if c, _, err := root.Find([]string{verb}); err == nil && c.Name() == verb {
				t.Errorf("`bk %s` still resolves — it must be spelled `bk <app> %s`", verb, verb)
			}
			c, _, err := root.Find([]string{issues.Slug, verb})
			if err != nil {
				t.Fatalf("`bk %s %s`: %v", issues.Slug, verb, err)
			}
			if c.Name() != verb {
				t.Fatalf("`bk %s %s` resolved to %q — the app-qualified spelling is the one "+
					"that has to work", issues.Slug, verb, c.CommandPath())
			}
		})
	}
}

// An app either mounts the whole tier or none of it.
//
// Discovered by walking the tree, so it covers `bk sales …` the day it is added
// without anyone remembering this file. A PARTIAL mount is the realistic
// mistake: someone adds `upload` to a new app and stops, leaving `bk sales trash
// list` to fail with "unknown command" while `bk sales upload` works — which
// reads as "sales has no recycle bin" rather than "this was not wired up".
//
// It cannot assert that a given app mounts them at all: `bk template …` is the
// scaffold and its deployment serves no platform routes, so claiming
// `POST /api/upload` there would be a claim on a route that does not exist. What
// catches a REAL app that forgets the mount is its own lib/cli-parity.test.ts —
// the route is in its tree and no `bk` command claims it, which is the coverage
// direction of that guard, checked against the filesystem rather than a list.
func TestAppGroupsMountTheWholeTierOrNoneOfIt(t *testing.T) {
	verbs := appOwnedVerbNames(t)
	root := NewRoot()

	groups := 0
	for _, group := range root.Commands() {
		if !group.HasSubCommands() || group.Hidden {
			continue
		}
		var have, missing []string
		for _, v := range verbs {
			if found := findChild(group, v); found != nil {
				have = append(have, v)
			} else {
				missing = append(missing, v)
			}
		}
		if len(have) == 0 {
			continue
		}
		groups++
		if len(missing) > 0 {
			t.Errorf("`bk %s` mounts %v but not %v — an app takes the whole app-owned tier "+
				"(appverbs.New(...).All()) or none of it", group.Name(), have, missing)
		}
	}
	if groups == 0 {
		t.Fatal("no command group mounts the app-owned verbs — either the tier was removed " +
			"or this walk is looking in the wrong place; either way it is checking nothing")
	}
}

func findChild(parent *cobra.Command, name string) *cobra.Command {
	for _, c := range parent.Commands() {
		if c.Name() == name {
			return c
		}
	}
	return nil
}

// Every removed spelling keeps a deprecations.go row that NAMES its replacement.
// Without this, dropping a bare verb and forgetting its hint looks exactly like a
// clean removal — until an agent runs the old command next week.
func TestRemovedBareVerbsCarryANamedHint(t *testing.T) {
	for _, verb := range appOwnedVerbNames(t) {
		t.Run(verb, func(t *testing.T) {
			// The string cobra ACTUALLY emits for the argv an agent would type.
			// Verified against the built binary: cobra's legacyArgs reports the
			// first token only (`unknown command "upload" for "bk"`), while
			// rejectUnknownSubcommands' RunE reports it for a group. Asserting a
			// hand-written approximation is how the previous version of this
			// check passed while the real binary served the generic hint.
			for _, errMsg := range []string{
				`unknown command "` + verb + `" for "bk"`,
				`unknown command "` + verb + ` list" for "bk"`,
			} {
				hint := DeprecationHint(errMsg)
				if hint == "" {
					t.Fatalf("no deprecation hint for %s — an agent running the old spelling "+
						"gets `unknown command` and nothing to act on", errMsg)
				}
				want := "bk " + issues.Slug + " " + verb
				if !strings.Contains(hint, want) {
					t.Errorf("the hint for `bk %s` does not name a concrete replacement (%q):\n  %s",
						verb, want, hint)
				}
			}
		})
	}
}

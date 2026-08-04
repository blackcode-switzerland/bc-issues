package commands

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/spf13/cobra"
)

// Phase 5's one user-visible break, and the thing that decides whether it hurt:
// every pre-1.10.0 spelling must still resolve to the SAME command, not merely
// exist.
//
// This is the failure mode the phase actually has. A broken alias does not show
// up in the session that wrote it — it shows up in someone's agent run next
// week, as `unknown command`, mid-task. So the assertions below compare the
// resolved command against the namespaced one it must be identical to, rather
// than checking that some command was found.

// resolve walks the tree the way cobra does and returns the command a full argv
// lands on, plus the args left over.
func resolve(t *testing.T, argv []string) (*cobra.Command, []string) {
	t.Helper()
	cmd, rest, err := NewRoot().Find(argv)
	if err != nil {
		t.Fatalf("bk %s: Find returned %v", strings.Join(argv, " "), err)
	}
	return cmd, rest
}

// Build the alias table from the app's own noun list rather than typing it out,
// so a noun added later cannot be silently left without an alias.
func aliasCases(t *testing.T) [][2][]string {
	t.Helper()
	var out [][2][]string
	for _, noun := range issues.LegacyTopLevel() {
		n := noun.Name()
		out = append(out, [2][]string{{n}, {issues.Slug, n}})
		for _, sub := range noun.Commands() {
			if sub.Name() == "help" || sub.Name() == "completion" {
				continue
			}
			out = append(out, [2][]string{{n, sub.Name()}, {issues.Slug, n, sub.Name()}})
			for _, leaf := range sub.Commands() {
				if leaf.Name() == "help" || leaf.Name() == "completion" {
					continue
				}
				out = append(out,
					[2][]string{{n, sub.Name(), leaf.Name()}, {issues.Slug, n, sub.Name(), leaf.Name()}})
			}
		}
	}
	if len(out) < 40 {
		t.Fatalf("only %d alias cases discovered — the noun list looks empty, "+
			"which would make every assertion below vacuous", len(out))
	}
	return out
}

func TestEveryOldSpellingResolvesToTheSameCommand(t *testing.T) {
	for _, tc := range aliasCases(t) {
		old, namespaced := tc[0], tc[1]
		t.Run(strings.Join(old, " "), func(t *testing.T) {
			gotOld, _ := resolve(t, old)
			gotNew, _ := resolve(t, namespaced)

			// The alias must land on a command of the same NAME at the same
			// depth — not on a parent group that merely accepted the extra
			// words as arguments.
			if gotOld.Name() != gotNew.Name() {
				t.Fatalf("`bk %s` resolved to %q but `bk %s` resolves to %q",
					strings.Join(old, " "), gotOld.CommandPath(),
					strings.Join(namespaced, " "), gotNew.CommandPath())
			}
			if len(strings.Fields(gotOld.CommandPath())) != len(old)+1 {
				t.Fatalf("`bk %s` resolved only as far as %q — the rest was swallowed as arguments",
					strings.Join(old, " "), gotOld.CommandPath())
			}
			// Same declared surface: the routes annotation is the contract the
			// parity test reads, so a drifted alias would be a route an agent
			// reaches by one spelling and not the other.
			if gotOld.Annotations["routes"] != gotNew.Annotations["routes"] {
				t.Fatalf("`bk %s` declares routes %q; `bk %s` declares %q",
					strings.Join(old, " "), gotOld.Annotations["routes"],
					strings.Join(namespaced, " "), gotNew.Annotations["routes"])
			}
			if gotOld.Short != gotNew.Short {
				t.Fatalf("`bk %s` and `bk %s` have drifted apart in help text",
					strings.Join(old, " "), strings.Join(namespaced, " "))
			}
		})
	}
}

// The alias must SAY it is one — exactly once, on stderr, naming the new
// spelling. Once, because a warning per tree level would be noise; on stderr,
// because an agent pipes stdout into jq.
func TestAliasWarnsOnceOnStderrNamingTheNewSpelling(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	cases := [][]string{
		{"issue", "list"},
		{"task", "create"},
		{"project", "list"},
		{"analytics"},
		{"issue", "comment"},
	}

	for _, argv := range cases {
		t.Run(strings.Join(argv, " "), func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			root := NewRoot()
			root.SetOut(&stdout)
			root.SetErr(&stderr)
			root.SetArgs(argv)
			_ = root.Execute() // fails on credentials; the warning comes first

			want := "deprecated: use 'bk " + issues.Slug + " " + strings.Join(argv, " ") + "'"
			got := stderr.String()
			if !strings.Contains(got, want) {
				t.Fatalf("stderr = %q; want it to contain %q", got, want)
			}
			if n := strings.Count(got, "deprecated: use"); n != 1 {
				t.Fatalf("printed the deprecation notice %d times, want exactly 1:\n%s", n, got)
			}
			if strings.Contains(stdout.String(), "deprecated") {
				t.Fatalf("deprecation notice reached stdout, which agents parse:\n%s", stdout.String())
			}
		})
	}
}

// The namespaced spelling is the one we are steering people to, so it must be
// silent.
func TestNamespacedSpellingDoesNotWarn(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	var stderr bytes.Buffer
	root := NewRoot()
	root.SetOut(&bytes.Buffer{})
	root.SetErr(&stderr)
	root.SetArgs([]string{issues.Slug, "issue", "list"})
	_ = root.Execute()

	if strings.Contains(stderr.String(), "deprecated") {
		t.Fatalf("`bk %s issue list` warned about itself:\n%s", issues.Slug, stderr.String())
	}
}

// Once the aliases are pruned, `bk issue create` becomes an unknown command —
// and that is precisely when deprecations.go has to carry the new spelling, or
// the removal dead-ends an agent mid-run. Assert the row exists NOW, while the
// alias still works, because the commit that prunes is the one least likely to
// remember.
func TestPruningTheAliasesStillLeavesAHint(t *testing.T) {
	for _, noun := range issues.LegacyTopLevel() {
		n := noun.Name()
		t.Run(n, func(t *testing.T) {
			errMsg := fmt.Sprintf("unknown command %q for %q", n, "bk")
			hint := DeprecationHint(errMsg)
			if hint == "" {
				t.Fatalf("no deprecations.go row for %q — when the alias is pruned, "+
					"`bk %s …` will fail with no way forward", n, n)
			}
			if !strings.Contains(hint, "bk "+issues.Slug+" "+n) {
				t.Fatalf("the hint for %q does not name the new spelling %q: %s",
					n, "bk "+issues.Slug+" "+n, hint)
			}
		})
	}
}

// The old spellings must not clutter `bk --help`; the new shape is what a
// first-time reader should see. They stay fully documented under their own
// --help, which is where someone following an old script will look.
func TestAliasesAreHiddenFromRootHelpButStillDocumented(t *testing.T) {
	root := NewRoot()
	for _, noun := range issues.LegacyTopLevel() {
		n := noun.Name()
		var found *cobra.Command
		for _, c := range root.Commands() {
			if c.Name() == n {
				found = c
			}
		}
		if found == nil {
			t.Fatalf("`bk %s` is not registered at all — the alias is gone, not deprecated", n)
		}
		if !found.Hidden {
			t.Errorf("`bk %s` is still listed in `bk --help`; it should be hidden", n)
		}
		if !found.HasSubCommands() && !found.Runnable() {
			t.Errorf("`bk %s` resolves to nothing runnable", n)
		}
	}
}

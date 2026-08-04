package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// Deprecated aliases for the pre-namespace command spellings.
//
// Phase 5 moved every app noun behind its app name: `bk issue create` became
// `bk issues issue create`. That is the only user-visible break in the whole
// platform migration, and it is deliberately absorbed here rather than paid by
// callers: every old spelling still RUNS, does exactly what it did before, and
// prints one line on stderr naming the new spelling.
//
// The alias is not a reimplementation. It is a second copy of the same command
// tree, built from the same constructors (see issues.LegacyTopLevel), so there
// is no second definition that could drift from the first. What the alias adds
// is the warning and the hidden-from-help flag — nothing else.
//
// Lifetime: two minor releases, then delete the registration here and the rows
// in deprecations.go. After that, `bk issue create` fails with "unknown command"
// and main.go's hintFor() serves the deprecations.go note instead, so even the
// removal names its own exit rather than dead-ending an agent mid-run.
//
// Why stderr and not stdout: stdout stays parseable. An agent piping `bk issue
// list --json` into jq must not have a deprecation notice land in its JSON.

// registerAppAliases adds each old top-level command to root under its bare
// name, hidden from `bk --help`, and returns them so the deprecation wrapper can
// be applied after rejectUnknownSubcommands has given the groups their RunE.
func registerAppAliases(root *cobra.Command, aliases []*cobra.Command) []*cobra.Command {
	for _, c := range aliases {
		// Hidden only affects the parent's help listing, not the command's own
		// help or its children — `bk issue --help` still works and still lists
		// every subcommand, which is what an agent following an old script needs.
		c.Hidden = true
		root.AddCommand(c)
	}
	return aliases
}

// deprecateTree makes every node of an alias subtree announce its new spelling
// once, on stderr, before doing exactly what it always did.
//
// The warning hangs off Args, not RunE, and that choice is the whole point.
// Cobra's order is: parse flags → ValidateArgs → PersistentPreRun → PreRun →
// Run. Hooking RunE means a call that fails argument validation — `bk issue
// comment` with the id left off — produces a usage error that never mentions
// the command was renamed, which is the moment the rename is most likely to be
// the real cause. Args runs before that check, so the notice survives it.
// Wrapping a nil Args is safe: cobra treats nil as ArbitraryArgs, which is what
// the wrapper falls back to.
//
// Help gets the same treatment, because `bk issue --help` is where someone
// following an old script looks first, and cobra returns from --help before
// ValidateArgs is ever reached.
//
// `warned` is shared across the whole subtree so the two paths cannot both fire
// on one invocation (`bk issue` validates args AND prints help). Per-tree rather
// than package-level, so each NewRoot() starts clean — tests build many.
//
// Must run AFTER rejectUnknownSubcommands, which is what gives a pure group its
// RunE in the first place.
func deprecateTree(cmd *cobra.Command, app string) {
	warned := false
	warn := func(c *cobra.Command) {
		if warned {
			return
		}
		warned = true
		warnRenamed(c, app)
	}

	var apply func(*cobra.Command)
	apply = func(c *cobra.Command) {
		inner := c.Args
		c.Args = func(cc *cobra.Command, args []string) error {
			warn(cc)
			if inner == nil {
				return nil // cobra's own default for a nil Args
			}
			return inner(cc, args)
		}
		for _, sub := range c.Commands() {
			apply(sub)
		}
	}
	apply(cmd)

	// Captured before SetHelpFunc so this delegates to the root's renderer
	// rather than recursing into itself. Children inherit it by walking up.
	baseHelp := cmd.HelpFunc()
	cmd.SetHelpFunc(func(c *cobra.Command, args []string) {
		warn(c)
		baseHelp(c, args)
	})
}

// warnRenamed prints `deprecated: use 'bk issues issue create'` for an
// invocation of `bk issue create`. The new spelling is derived from the path
// actually invoked rather than stored per command, so an alias cannot name a
// replacement that does not exist.
func warnRenamed(c *cobra.Command, app string) {
	parts := strings.Fields(c.CommandPath())
	if len(parts) < 2 {
		return
	}
	renamed := append([]string{parts[0], app}, parts[1:]...)
	fmt.Fprintf(c.ErrOrStderr(), "deprecated: use '%s'\n", strings.Join(renamed, " "))
}

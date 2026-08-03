package commands

import (
	"io"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// groupPaths returns the argv path of every command GROUP in the tree — a
// command that has subcommands, i.e. one a user can mistype a subcommand under.
// The root itself is included: `bk notacmd` must fail too.
func groupPaths(cmd *cobra.Command, prefix []string) [][]string {
	var out [][]string
	if !cmd.HasSubCommands() {
		return out
	}
	out = append(out, prefix)
	for _, sub := range cmd.Commands() {
		if sub.Name() == "help" || sub.Name() == "completion" {
			continue // cobra's own, and they take arbitrary args by design
		}
		out = append(out, groupPaths(sub, append(append([]string{}, prefix...), sub.Name()))...)
	}
	return out
}

// An unknown subcommand must be an ERROR, not a silent help-and-exit-0.
//
// Cobra's default for a group is to print help and return nil, which an agent
// branching on exit codes reads as success — and which makes main.go's
// "unknown command" deprecation hint unreachable. rejectUnknownSubcommands() in
// root.go fixes it; this asserts it stays fixed for every group, including ones
// added later.
func TestUnknownSubcommandIsAnError(t *testing.T) {
	const bogus = "definitely-not-a-real-command"

	for _, path := range groupPaths(NewRoot(), nil) {
		argv := append(append([]string{}, path...), bogus)
		name := "bk"
		if len(path) > 0 {
			name = "bk " + strings.Join(path, " ")
		}

		t.Run(name, func(t *testing.T) {
			// A fresh tree per case: Execute() mutates command state.
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(argv)

			err := root.Execute()
			if err == nil {
				t.Fatalf("`%s %s` returned no error — a mistyped subcommand would exit 0", name, bogus)
			}
			if !strings.Contains(err.Error(), "unknown command") {
				t.Fatalf("`%s %s` failed with %q; want an \"unknown command\" error so "+
					"main.go can classify it as usage (exit 2) and offer a deprecation hint",
					name, bogus, err)
			}
		})
	}
}

// A group invoked with no arguments is a legitimate "what can this do?" — it
// must print help and succeed, not error.
func TestGroupWithNoArgsSucceeds(t *testing.T) {
	for _, path := range groupPaths(NewRoot(), nil) {
		if len(path) == 0 {
			continue // bare `bk` is covered by cobra's own root help
		}
		name := "bk " + strings.Join(path, " ")

		t.Run(name, func(t *testing.T) {
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(path)

			if err := root.Execute(); err != nil {
				t.Fatalf("`%s` with no args returned %q; want help + success", name, err)
			}
		})
	}
}

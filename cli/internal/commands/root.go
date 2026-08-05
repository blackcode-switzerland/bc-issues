package commands

import (
	"fmt"
	"os"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/platform"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// The --ws override and the -v flag are bound to cmdutil.WSOverride /
// cmdutil.VerboseFlag below. They live in cmdutil rather than here because both
// command packages (platform and issues) read them, and those two must not
// import each other — PLATFORM-ARCHITECTURE.md §7.1.

// rootLong is deliberately thin. It used to duplicate the web manifest's
// "conventions for agents" block, which meant every convention lived in two
// places and drifted. All of that now lives in the embedded guide
// (internal/guide/topics), which ships with the binary and is served by
// `bk guide`. What stays here: what bk is, the first run, the global flags, the
// exit codes, the command groups, and one loud pointer.
const rootLong = `bk is the CLI for the Blackcode platform — workspaces, members,
labels, files, tokens and inbox, plus one command group per app.

It is the ONLY supported interface. The HTTP API behind it is private plumbing
with no public contract.

Agents: run "bk guide" first — it is the complete, always-current usage guide
for THIS binary. Then "bk meta" to pick your workspace.

First run:
  bk login --server URL    # opens browser, captures token
  bk skill install         # write the agent skill file for this project
  bk guide                 # how to use this binary (offline, no auth needed)
  bk meta                  # who am I + every workspace I can write to + live limits
  bk workspace use <slug>  # set active workspace (pick by name/slug, not id)

Global flags:
  -o table|json|yaml|yml   output format (default: table)
  --json / --yaml / --yml  shortcuts; piping to jq/yq is intended
  --ws <slug|id>           target ONE command at another workspace
  -v / --verbose           log each HTTP request/response to stderr

Exit codes (stable; for branching in scripts/agents):
  0 ok   1 generic   2 usage   3 auth(401)   4 perm(403)
  5 not-found(404)   6 validation(400/422)   7 user-aborted
  8 client too old   9 update available

PLATFORM verbs — shared by every app, so they stay at the top level:
  guide       the embedded usage guide (--list, <topic>, --json)
  skill       install / check / sync the agent skill file
  workspace   list (--all for every workspace + per-app badges), show, create,
              edit, transfer, use
  app         which apps a workspace runs, and who may use them (access grants)
  label       list, view, create, delete, attach, detach
  member      list, remove, leave
  invite      send, list, accept, decline, revoke, pending, candidates
  token       list, create, delete
  profile     view, edit
  inbox       list, read, archive, unarchive
  upload      upload a file and print its url
  storage     list, rm, attachments (workspace owner)
  trash       list, restore, purge, empty
  undo        roll back your last N writes
  activity    merged activity feed across every app (--since, --app, --subject)
  search      federated search across every app's entities (returns URNs)
  link        relate two entities by URN, across apps (create, list, rm)
  changelog   the dated record of what changed
  super-admin users, whitelist, errors (super admins only; platform-wide)

APPS — every app verb sits behind its app name:
  issues      issue, task, project, move, copy, analytics

New in 1.11.0: every issue, task and project is addressable by a URN —
bc:issues:<workspace>/<type>/<number> — so "bk search" spans apps and "bk link"
relates two things that live in different ones. Run "bk guide platform/cross-app".

Renamed in 1.10.0: app nouns moved behind the app name, so "bk issue list" is
now "bk issues issue list". Every old spelling still works and prints one
deprecation line; they go away two minor releases from now. Run "bk changelog".

Discover flags before calling: bk <group> --help, then bk <group> <cmd> --help.`

func NewRoot() *cobra.Command {
	root := &cobra.Command{
		Use:          "bk",
		Short:        "Blackcode platform command-line interface",
		Long:         rootLong,
		SilenceUsage: true,
		// main.go owns error output: it prints `error: <msg>` and, when the
		// failure is one an agent can recover from, a `hint:` line under it.
		// Letting cobra print too gave every failure two lines saying the same
		// thing on the channel agents parse.
		SilenceErrors: true,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			// Verbose can be turned on per-invocation (--verbose) or via env.
			if cmdutil.VerboseFlag || os.Getenv("BK_DEBUG") == "1" {
				client.Verbose = true
			}
		},
	}
	output.RegisterFlags(root)
	root.PersistentFlags().StringVar(&cmdutil.WSOverride, "ws", "", "Target workspace (slug or id) for this command only; does not change the active workspace")
	root.PersistentFlags().BoolVarP(&cmdutil.VerboseFlag, "verbose", "v", false, "Log each HTTP request/response to stderr (or set BK_DEBUG=1)")
	// Bare verbs: everything shared by every app.
	root.AddCommand(platform.NewCommands()...)
	root.AddCommand(newRoutesCmd())

	// One entry per app. Adding an app is adding a line here plus its package —
	// which is the whole point of the migration.
	root.AddCommand(issues.NewGroup())

	// …and the pre-1.10.0 spellings, still working. Registered before
	// rejectUnknownSubcommands so the groups get their RunE, and deprecated
	// after it so that RunE is what carries the warning.
	aliases := registerAppAliases(root, issues.LegacyTopLevel())

	rejectUnknownSubcommands(root)

	for _, c := range aliases {
		deprecateTree(c, issues.Slug)
	}
	return root
}

// rejectUnknownSubcommands makes a mistyped subcommand a hard failure instead of
// a silent success.
//
// Cobra's default for a command GROUP (a command that has subcommands but no
// action of its own) is to print help and return nil — so `bk workspace notacmd`
// exited 0. For an agent branching on exit codes that reads as "it worked", and
// it also made the deprecation machinery unreachable: main.go's hintFor() has an
// "unknown command" branch feeding DeprecationHint, and it could never fire for
// a renamed subcommand.
//
// The fix has to be a RunE rather than `Args: cobra.NoArgs`, because cobra
// returns flag.ErrHelp for any non-runnable command BEFORE it validates args —
// so NoArgs on a group never runs. Giving the group a RunE makes it runnable,
// and the RunE does the check itself.
//
// Applied here by walking the tree, so it covers every group that exists now and
// every one added later without anyone remembering to opt in. groups_test.go
// asserts it holds.
func rejectUnknownSubcommands(cmd *cobra.Command) {
	for _, sub := range cmd.Commands() {
		rejectUnknownSubcommands(sub)
	}
	if !cmd.HasSubCommands() || cmd.Runnable() {
		return
	}
	cmd.RunE = func(c *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("unknown command %q for %q", args[0], c.CommandPath())
		}
		// No args: `bk workspace` on its own is a legitimate way to ask what a
		// group can do. Print help and succeed.
		return c.Help()
	}
}

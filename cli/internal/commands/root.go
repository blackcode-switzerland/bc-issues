package commands

import (
	"fmt"
	"os"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// wsOverride is the per-invocation workspace target set by the persistent --ws
// flag. When non-empty it overrides cfg.ActiveWorkspaceSlug for that command
// only (a read must never mutate the active workspace). verboseFlag backs -v.
var (
	wsOverride  string
	verboseFlag bool
)

// clientWorkspaceSlug returns the workspace slug/id the client should target:
// the --ws override when set, otherwise the active workspace from config.
func clientWorkspaceSlug(cfg *config.Config) string {
	if strings.TrimSpace(wsOverride) != "" {
		return wsOverride
	}
	return cfg.ActiveWorkspaceSlug
}

// rootLong is deliberately thin. It used to duplicate the web manifest's
// "conventions for agents" block, which meant every convention lived in two
// places and drifted. All of that now lives in the embedded guide
// (internal/guide/topics), which ships with the binary and is served by
// `bk guide`. What stays here: what bk is, the first run, the global flags, the
// exit codes, the command groups, and one loud pointer.
const rootLong = `bk is the CLI for blackcode issues — projects, issues, tasks,
comments, labels, members, files, tokens, inbox and analytics.

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

Command groups:
  guide       the embedded usage guide (--list, <topic>, --json)
  skill       install / check / sync the agent skill file
  workspace   list, show, create, edit, transfer, use
  move/copy   move (or copy) projects/tasks/issues to another workspace (--to)
  project     list, view, create, edit, delete, members, updates, comment(s)
  issue       list, view, create, edit, delete, assign, watch, comment(s),
              edit-comment, delete-comment, attach, detach, activity
  task        list, view, create, edit, delete, comment(s)
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
  activity    workspace activity feed (paginated)
  analytics   workspace analytics
  changelog   the dated record of what changed
  super-admin users, whitelist, errors (super admins only; platform-wide)

Discover flags before calling: bk <group> --help, then bk <group> <cmd> --help.`

func NewRoot() *cobra.Command {
	root := &cobra.Command{
		Use:           "bk",
		Short:         "blackcode-issues command-line interface",
		Long:          rootLong,
		SilenceUsage: true,
		// main.go owns error output: it prints `error: <msg>` and, when the
		// failure is one an agent can recover from, a `hint:` line under it.
		// Letting cobra print too gave every failure two lines saying the same
		// thing on the channel agents parse.
		SilenceErrors: true,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			// Verbose can be turned on per-invocation (--verbose) or via env.
			if verboseFlag || os.Getenv("BK_DEBUG") == "1" {
				client.Verbose = true
			}
		},
	}
	output.RegisterFlags(root)
	root.PersistentFlags().StringVar(&wsOverride, "ws", "", "Target workspace (slug or id) for this command only; does not change the active workspace")
	root.PersistentFlags().BoolVarP(&verboseFlag, "verbose", "v", false, "Log each HTTP request/response to stderr (or set BK_DEBUG=1)")
	root.AddCommand(
		newGuideCmd(),
		newSkillCmd(),
		newRoutesCmd(),
		newLoginCmd(),
		newLogoutCmd(),
		newWhoamiCmd(),
		newMetaCmd(),
		newProfileCmd(),
		newWorkspaceCmd(),
		newProjectCmd(),
		newIssueCmd(),
		newMoveCmd(),
		newCopyCmd(),
		newUserCmd(),
		newTaskCmd(),
		newLabelCmd(),
		newMemberCmd(),
		newInviteCmd(),
		newInboxCmd(),
		newTokenCmd(),
		newActivityCmd(),
		newAnalyticsCmd(),
		newUploadCmd(),
		newStorageCmd(),
		newTrashCmd(),
		newUndoCmd(),
		newChangelogCmd(),
		newSuperAdminCmd(),
		newVersionCmd(),
	)
	rejectUnknownSubcommands(root)
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

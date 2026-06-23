package commands

import (
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

const rootLong = `bk is the CLI for blackcode-issues. Every feature on the website
is available here: projects, issues, tasks, comments, labels,
members, tokens, inbox, analytics, and more.

First run:
  bk login --server URL    # opens browser, captures token
  bk whoami                # confirm identity
  bk workspace use <slug>  # set active workspace

Output formats (every read command):
  -o table|json|yaml|yml   default: table
  --json / --yaml / --yml  shortcuts; piping to jq/yq is intended

Exit codes (stable; for branching in scripts/agents):
  0 ok   1 generic   2 usage   3 auth(401)   4 perm(403)
  5 not-found(404)   6 validation(400)   7 user-aborted

Conventions for agents:
  • a project/issue/task is addressed by its #number (the value shown in the
    app), unique per workspace — there is no separate global id. See docs/api-changelog.md.
  • set BK_NO_PROMPT=1 in env to skip every "are you sure?" prompt
    (delete / remove-member / detach / undo). --yes per-command also works.
  • long bodies (--description, --body) accept three forms:
      "literal", "-" to read stdin, or paired --*-file FILE
  • clearing a nullable field on edit: pass the literal "none" (or
    "null"/"unset"/"clear") to --assignee, --task, --due-date,
    --start-date. Omit the flag to leave it unchanged.
  • --assignee accepts: numeric id | email | display name | "me"
  • bk undo --count N rolls back your last N writes (max 10).
  • the surface is large — run "bk <group> --help" then
    "bk <group> <cmd> --help" to discover flags before calling.

Command groups:
  workspace   list, create, edit, transfer, use
  project     list, view, create, edit, delete, members, updates, comment(s)
  issue       list, view, create, edit, delete, assign, watch, comment(s),
              edit-comment, delete-comment, attach, activity
  task   list, view, create, edit, delete, comment(s)
  label       list, create, delete, attach, detach
  member      list, remove, leave
  invite      send, list, accept, decline, revoke, pending
  token       list, create, delete
  profile     view, edit
  inbox       list, read, archive, unarchive
  super-admin users, whitelist, errors (super admins only; platform-wide)`

func NewRoot() *cobra.Command {
	root := &cobra.Command{
		Use:           "bk",
		Short:         "blackcode-issues command-line interface",
		Long:          rootLong,
		SilenceUsage:  true,
		SilenceErrors: false,
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
		newLoginCmd(),
		newLogoutCmd(),
		newWhoamiCmd(),
		newProfileCmd(),
		newWorkspaceCmd(),
		newProjectCmd(),
		newIssueCmd(),
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
		newSuperAdminCmd(),
		newVersionCmd(),
	)
	return root
}

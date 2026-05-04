package commands

import (
	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

const rootLong = `bk is the CLI for blackcode-issues. It reads and writes the entire
platform — projects, issues, comments, milestones, attachments,
members — bounded by the caller's token permissions.

First run:
  bk login --server URL    # opens browser, captures token
  bk whoami                # confirm identity

Output formats (every read command):
  -o table|json|yaml|yml   default: table
  --json / --yaml / --yml  shortcuts; piping to jq/yq is intended

Exit codes (stable; for branching in scripts/agents):
  0 ok   1 generic   2 usage   3 auth(401)   4 perm(403)
  5 not-found(404)   6 validation(400)   7 user-aborted

Conventions for agents:
  • set BK_NO_PROMPT=1 in env to skip every "are you sure?" prompt
    (delete / remove-member / detach / undo). --yes per-command also works.
  • long bodies (--description, --body) accept three forms:
      "literal", "-" to read stdin, or paired --*-file FILE
  • clearing a nullable field on edit: pass the literal "none" (or
    "null"/"unset"/"clear") to --assignee, --milestone, --due-date,
    --start-date. Omit the flag to leave it unchanged.
  • --assignee accepts: numeric id | email | display name | "me"
  • bk undo --count N rolls back your last N writes (max 10).
  • the surface is large — run "bk <group> --help" then
    "bk <group> <cmd> --help" to discover flags before calling.`


func NewRoot() *cobra.Command {
	root := &cobra.Command{
		Use:           "bk",
		Short:         "blackcode-issues command-line interface",
		Long:          rootLong,
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	output.RegisterFlags(root)
	root.AddCommand(
		newLoginCmd(),
		newLogoutCmd(),
		newWhoamiCmd(),
		newProjectCmd(),
		newIssueCmd(),
		newUserCmd(),
		newMilestoneCmd(),
		newActivityCmd(),
		newAnalyticsCmd(),
		newUndoCmd(),
		newVersionCmd(),
	)
	return root
}

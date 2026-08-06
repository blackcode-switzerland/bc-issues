package issues

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// What THIS app adds to the four app-owned platform verbs (D-11).
//
// `internal/appverbs` builds `upload`, `storage`, `trash` and `label` for every
// app. Two of those groups have subcommands that name an ENTITY rather than a
// workspace, and an entity belongs to one app:
//
//	label attach|detach   takes an issue and posts to /api/workspaces/{ws}/issues/{id}/labels
//	storage attachments   lists the issue-attachment rows behind `bk issues issue attach`
//
// They live here, not in the shared package, and that is the split that keeps
// the parity guard honest: `bk __routes` tags them with this app, so the claim
// is checked against apps/issues — the tree that actually serves them. Put them
// in the shared package and every app would claim an issues route.
func appOwnedVerbs() []*cobra.Command {
	set := appverbs.New(appverbs.Config{
		App: Slug,
		// This app's binnable entity types. Declared here because they are this
		// app's vocabulary — see the Config field's comment.
		TrashTypes: []string{"issue", "project", "task"},
	})
	set.Label.AddCommand(newLabelAttachCmd(), newLabelDetachCmd())
	set.Storage.AddCommand(newStorageAttachmentsCmd())
	return set.All()
}

func newLabelAttachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attach <issue_id> <label_id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/labels,GET /api/workspaces/{ws}/issues/{id}/labels"},
		Short:       "Attach a label to an issue",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.AttachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "attached label %d to issue %d\n", labelID, issueID)
			return nil
		},
	}
}

func newLabelDetachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "detach <issue_id> <label_id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid}"},
		Short:       "Detach a label from an issue",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.DetachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "detached label %d from issue %d\n", labelID, issueID)
			return nil
		},
	}
}

func newStorageAttachmentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attachments",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/attachments"},
		Short:       "List all issue-attachment rows in the workspace",
		Long: `List the workspace's attachments table — every file attached to an issue via
the API/CLI ("bk issues issue attach"). This is separate from files embedded
inline in descriptions/comments (see "bk issues storage list" for everything).`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			atts, err := c.ListWorkspaceAttachments()
			if err != nil {
				return err
			}
			return output.Render(format, atts, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tISSUE\tFILENAME\tSIZE\tURL")
				for _, a := range atts {
					issue := "—"
					if a.IssueSeq != nil {
						issue = "#" + strconv.Itoa(*a.IssueSeq)
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						a.ID, issue, a.Filename, appverbs.HumanSize(a.FileSize), a.FileURL)
				}
				return tw.Flush()
			})
		},
	}
}

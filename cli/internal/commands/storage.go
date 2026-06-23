package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newStorageCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "storage",
		Short: "Manage uploaded files in the active workspace (owner only)",
		Long: `Review and clean up files uploaded into the workspace.

Every file ever uploaded (via the web, the API, or the CLI) is tracked. Removing
a file from a description or comment does NOT delete the stored bytes — that is
deliberate, so undo and trash-restore stay safe. Use these commands to see what
is taking up space and to permanently delete files that nothing references.

Owner only.`,
	}
	cmd.AddCommand(newStorageListCmd(), newStorageRmCmd(), newStorageAttachmentsCmd())
	return cmd
}

func newStorageListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List uploaded files with reference counts and total usage",
		Long: `List every uploaded file in the workspace.

REFS is how many things reference the file (descriptions, comments, attachments —
including items in the recycle bin). A file with REFS = 0 is an orphan and can be
removed with "bk storage rm <id>".`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			listing, err := c.ListStorage()
			if err != nil {
				return err
			}
			return output.Render(format, listing, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tFILENAME\tSIZE\tREFS\tUPLOADED BY\tURL")
				for _, f := range listing.Data {
					uploader := "—"
					if f.UploaderName != nil && *f.UploaderName != "" {
						uploader = *f.UploaderName
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%d\t%s\t%s\n",
						f.ID, f.Filename, humanSize(f.Size), f.ReferenceCount, uploader, f.URL)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintf(w, "\n%d file(s), %s used", listing.Total, humanBytes(int(listing.UsageBytes)))
				if listing.LimitBytes != nil {
					fmt.Fprintf(w, " of %s limit", humanBytes(int(*listing.LimitBytes)))
				}
				fmt.Fprintln(w)
				return nil
			})
		},
	}
}

func newStorageRmCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "rm <id>",
		Short: "Permanently delete an orphaned file",
		Long: `Permanently delete a stored file by its id (from "bk storage list").

The server refuses (exit non-zero) if anything still references the file,
including items in the recycle bin — remove those references or empty the trash
first. Deletion is irreversible.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("id must be an integer: %q", args[0])
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if !Confirm(fmt.Sprintf("Permanently delete file #%d? This cannot be undone.", id), yes) {
				return nil
			}
			if err := c.DeleteStorageFile(id); err != nil {
				return err
			}
			fmt.Printf("Deleted file #%d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newStorageAttachmentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "attachments",
		Short: "List all issue-attachment rows in the workspace",
		Long: `List the workspace's attachments table — every file attached to an issue via
the API/CLI ("bk issue attach"). This is separate from files embedded inline in
descriptions/comments (see "bk storage list" for everything).`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
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
						a.ID, issue, a.Filename, humanSize(a.FileSize), a.FileURL)
				}
				return tw.Flush()
			})
		},
	}
}

// humanSize formats an optional byte count (*int) for table output, reusing the
// shared humanBytes formatter (defined in issue.go).
func humanSize(n *int) string {
	if n == nil {
		return "—"
	}
	return humanBytes(*n)
}

package appverbs

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk <app> storage` — the file cabinet behind `bk <app> upload`.
//
// READ THE `--app` NOTE IN THE LIST HELP BELOW. Uploads are one shared table, so
// the LISTING is workspace-wide whichever app you ask; the app segment says
// which deployment answers and which app a new file would be filed under. That
// is a genuinely awkward corner of the app-owned tier and it is written down
// rather than smoothed over.
func newStorageCmd(cfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "storage",
		Short: scoped(cfg, "Manage uploaded files in the active workspace (owner only)"),
		Long: `Review and clean up files uploaded into the workspace.

Every file ever uploaded (via the web, the API, or the CLI) is tracked. Removing
a file from a description or comment does NOT delete the stored bytes — that is
deliberate, so trash-restore stays safe. Use these commands to see what is taking
up space and to permanently delete files that nothing references.

Owner only.`,
	}
	cmd.AddCommand(newStorageListCmd(cfg), newStorageRmCmd(cfg))
	return cmd
}

func newStorageListCmd(cfg Config) *cobra.Command {
	var app string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/storage"},
		Short:       "List uploaded files with reference counts and total usage",
		Long: `List every uploaded file in the workspace.

Storage is ONE shared cabinet: this list is workspace-wide and spans every app,
whichever app group you reach it through. APP is the app that uploaded each file;
--app <slug> narrows the list to one. The usage total stays workspace-wide even
when the list is filtered, because the quota belongs to the workspace.

REFS is how many things reference the file (descriptions, comments, attachments —
including items in the recycle bin), counted across every app. A file with
REFS = 0 is an orphan and can be removed with "storage rm <id>".`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			listing, err := c.ListStorage(app)
			if err != nil {
				return err
			}
			return output.Render(format, listing, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tAPP\tFILENAME\tSIZE\tREFS\tUPLOADED BY\tURL")
				for _, f := range listing.Data {
					uploader := "—"
					if f.UploaderName != nil && *f.UploaderName != "" {
						uploader = *f.UploaderName
					}
					appName := "—"
					if f.App != nil && *f.App != "" {
						appName = *f.App
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d\t%s\t%s\n",
						f.ID, appName, f.Filename, HumanSize(f.Size), f.ReferenceCount, uploader, f.URL)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintf(w, "\n%d file(s), %s used", listing.Total, cmdutil.HumanBytes(int(listing.UsageBytes)))
				if listing.LimitBytes != nil {
					fmt.Fprintf(w, " of %s limit", cmdutil.HumanBytes(int(*listing.LimitBytes)))
				}
				fmt.Fprintln(w)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&app, "app", "", "Only files uploaded by this app (e.g. "+cfg.App+")")
	return cmd
}

func newStorageRmCmd(cfg Config) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "rm <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/storage/{id}"},
		Short:       "Permanently delete an orphaned file",
		Long: `Permanently delete a stored file by its id (from "storage list").

The server refuses (exit non-zero) if anything still references the file,
including items in the recycle bin — remove those references or empty the trash
first. Deletion is irreversible.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("id must be an integer: %q", args[0])
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete file #%d? This cannot be undone.", id), yes) {
				return nil
			}
			if err := c.DeleteStorageFile(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Deleted file #%d\n", id)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// HumanSize formats an optional byte count (*int) for table output. Exported
// because an app's own additions to these groups format the same columns —
// `bk issues storage attachments` prints a SIZE.
func HumanSize(n *int) string {
	if n == nil {
		return "—"
	}
	return cmdutil.HumanBytes(*n)
}

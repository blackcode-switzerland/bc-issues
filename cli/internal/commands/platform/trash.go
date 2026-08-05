package platform

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// newTrashCmd is the recycle bin: list / restore / purge / empty the soft-
// deleted issues, projects, and tasks in the active workspace.
func newTrashCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "trash",
		Aliases: []string{"recycle", "bin"},
		Short:   "Manage the recycle bin (deleted issues, projects, tasks)",
	}
	cmd.AddCommand(
		newTrashListCmd(),
		newTrashRestoreCmd(),
		newTrashPurgeCmd(),
		newTrashEmptyCmd(),
	)
	return cmd
}

// parseRefs turns "issue:42 project:3" style args into entity refs.
//
// The number is the workspace #NUMBER, as printed in `bk trash list`'s REF
// column and as used by every other command. Before 1.12.0 it was the row id;
// see TrashEntityRef for why the wire field changed name rather than meaning.
func parseRefs(args []string) ([]client.TrashEntityRef, error) {
	refs := make([]client.TrashEntityRef, 0, len(args))
	for _, a := range args {
		parts := strings.SplitN(a, ":", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid ref %q — use <type>:<#number>, e.g. issue:42", a)
		}
		typ := strings.ToLower(strings.TrimSpace(parts[0]))
		switch typ {
		case "issue", "project", "task":
		default:
			return nil, fmt.Errorf("invalid type %q — must be issue, project, or task", parts[0])
		}
		n, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("invalid #number in %q: %w", a, err)
		}
		if n < 1 {
			return nil, fmt.Errorf("invalid #number in %q: must be 1 or greater", a)
		}
		refs = append(refs, client.TrashEntityRef{Type: typ, Number: n})
	}
	return refs, nil
}

func newTrashListCmd() *cobra.Command {
	var typ string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/trash"},
		Short:       "List items in the recycle bin",
		RunE: func(cmd *cobra.Command, args []string) error {
			switch typ {
			case "", "issue", "project", "task":
			default:
				return fmt.Errorf("--type must be issue, project, or task")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			items, err := c.ListTrash(ws, typ)
			if err != nil {
				return err
			}
			return output.Render(format, items, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "REF\tTITLE\tDELETED\tBY\tBATCH")
				unaddressable := 0
				for _, it := range items {
					// The REF column is what a user pastes straight back into
					// `restore`/`purge`, so it must be the #number the server now
					// expects. A row with no #number cannot be addressed at all —
					// say so rather than printing the row id, which would be read
					// as a #number and act on a different row.
					ref := "—"
					if it.Seq != nil {
						ref = fmt.Sprintf("%s:%d", it.Type, *it.Seq)
					} else {
						unaddressable++
					}
					by := "—"
					if it.DeletedByName != nil {
						by = *it.DeletedByName
					}
					batch := "—"
					if it.BatchID != nil {
						batch = strconv.Itoa(*it.BatchID)
						if it.BatchMode != nil {
							batch += " (" + *it.BatchMode + ")"
						}
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", ref, truncateTitle(it.Title), it.DeletedAt, by, batch)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(trash is empty)")
				}
				if unaddressable > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(),
						"warning: %d item(s) have no #number and cannot be restored or purged by ref; use --batch\n",
						unaddressable)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&typ, "type", "", "Filter by type: issue | project | task")
	return cmd
}

func newTrashRestoreCmd() *cobra.Command {
	var batch int
	var restoreParents, standalone bool
	cmd := &cobra.Command{
		Use:         "restore [<type:#number>...]",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/trash/restore"},
		Short:       "Restore items (or a whole batch) from the recycle bin",
		Long: "Restore deleted items back to the workspace.\n\n" +
			"Pass refs like `issue:42 project:3` (the #number, as printed in the REF\n" +
			"column), or restore a whole delete group with\n" +
			"--batch <id> (see the BATCH column in `bk trash list`).\n\n" +
			"If a restored item's project/task is also in the Trash, by default it\n" +
			"comes back as a group when they were deleted together, otherwise standalone.\n" +
			"Force the choice with --restore-parents or --standalone.",
		RunE: func(cmd *cobra.Command, args []string) error {
			if restoreParents && standalone {
				return fmt.Errorf("--restore-parents and --standalone are mutually exclusive")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}

			req := client.RestoreTrashRequest{}
			if cmd.Flags().Changed("batch") {
				req.BatchID = &batch
			} else {
				refs, err := parseRefs(args)
				if err != nil {
					return err
				}
				if len(refs) == 0 {
					return fmt.Errorf("provide one or more <type:#number> refs, or --batch <id>")
				}
				req.Items = refs
				if restoreParents || standalone {
					res := "restore_parent"
					if standalone {
						res = "standalone"
					}
					req.Resolutions = map[string]string{}
					for _, r := range refs {
						req.Resolutions[fmt.Sprintf("%s:%d", r.Type, r.Number)] = res
					}
				}
			}

			resp, err := c.RestoreTrash(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, resp, func(w io.Writer) error {
				fmt.Fprintf(w, "restored %d item(s)\n", resp.Count)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&batch, "batch", 0, "Restore an entire delete batch by id")
	cmd.Flags().BoolVar(&restoreParents, "restore-parents", false, "Also restore deleted parent projects/tasks")
	cmd.Flags().BoolVar(&standalone, "standalone", false, "Restore items standalone, clearing dangling parent links")
	return cmd
}

func newTrashPurgeCmd() *cobra.Command {
	var batch int
	var yes bool
	cmd := &cobra.Command{
		Use:         "purge [<type:#number>...]",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/trash/purge"},
		Short:       "Permanently delete items from the recycle bin (owner only)",
		Long: "Permanently delete binned items. This cannot be undone and requires the\n" +
			"workspace owner role. Pass refs like `issue:42` (the #number, as printed\n" +
			"in the REF column), or --batch <id>.\n\n" +
			"Any files embedded in the deleted items are automatically removed from\n" +
			"storage once nothing else in the workspace references them (same safety\n" +
			"check the Storage page uses).",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}

			req := client.PurgeTrashRequest{}
			target := ""
			if cmd.Flags().Changed("batch") {
				req.BatchID = &batch
				target = fmt.Sprintf("batch #%d", batch)
			} else {
				refs, err := parseRefs(args)
				if err != nil {
					return err
				}
				if len(refs) == 0 {
					return fmt.Errorf("provide one or more <type:#number> refs, or --batch <id>")
				}
				req.Items = refs
				target = fmt.Sprintf("%d item(s)", len(refs))
			}

			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete %s? This cannot be undone.", target), yes) {
				return fmt.Errorf("aborted")
			}
			purged, err := c.PurgeTrash(ws, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "permanently deleted %d item(s)\n", purged)
			return nil
		},
	}
	cmd.Flags().IntVar(&batch, "batch", 0, "Purge an entire delete batch by id")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newTrashEmptyCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "empty",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/trash/empty"},
		Short:       "Permanently delete everything in the recycle bin (owner only)",
		Long: "Permanently delete everything in the workspace recycle bin. Owner only.\n\n" +
			"Any files embedded in the deleted items are automatically removed from\n" +
			"storage once nothing else in the workspace references them (same safety\n" +
			"check the Storage page uses).",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm("Permanently delete everything in the Trash? This cannot be undone.", yes) {
				return fmt.Errorf("aborted")
			}
			purged, err := c.EmptyTrash(ws)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "emptied Trash (%d item(s))\n", purged)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func truncateTitle(s string) string {
	const max = 48
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

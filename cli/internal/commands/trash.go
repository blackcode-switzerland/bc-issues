package commands

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// newTrashCmd is the recycle bin: list / restore / purge / empty the soft-
// deleted issues, projects, and milestones in the active workspace.
func newTrashCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "trash",
		Aliases: []string{"recycle", "bin"},
		Short:   "Manage the recycle bin (deleted issues, projects, milestones)",
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
func parseRefs(args []string) ([]client.TrashEntityRef, error) {
	refs := make([]client.TrashEntityRef, 0, len(args))
	for _, a := range args {
		parts := strings.SplitN(a, ":", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid ref %q — use <type>:<id>, e.g. issue:42", a)
		}
		typ := strings.ToLower(strings.TrimSpace(parts[0]))
		switch typ {
		case "issue", "project", "milestone":
		default:
			return nil, fmt.Errorf("invalid type %q — must be issue, project, or milestone", parts[0])
		}
		id, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("invalid id in %q: %w", a, err)
		}
		refs = append(refs, client.TrashEntityRef{Type: typ, ID: id})
	}
	return refs, nil
}

func newTrashListCmd() *cobra.Command {
	var typ string
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List items in the recycle bin",
		RunE: func(cmd *cobra.Command, args []string) error {
			switch typ {
			case "", "issue", "project", "milestone":
			default:
				return fmt.Errorf("--type must be issue, project, or milestone")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
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
				for _, it := range items {
					ref := fmt.Sprintf("%s:%d", it.Type, it.ID)
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
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&typ, "type", "", "Filter by type: issue | project | milestone")
	return cmd
}

func newTrashRestoreCmd() *cobra.Command {
	var batch int
	var restoreParents, standalone bool
	cmd := &cobra.Command{
		Use:   "restore [<type:id>...]",
		Short: "Restore items (or a whole batch) from the recycle bin",
		Long: "Restore deleted items back to the workspace.\n\n" +
			"Pass refs like `issue:42 project:3`, or restore a whole delete group with\n" +
			"--batch <id> (see the BATCH column in `bk trash list`).\n\n" +
			"If a restored item's project/milestone is also in the Trash, by default it\n" +
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
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
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
					return fmt.Errorf("provide one or more <type:id> refs, or --batch <id>")
				}
				req.Items = refs
				if restoreParents || standalone {
					res := "restore_parent"
					if standalone {
						res = "standalone"
					}
					req.Resolutions = map[string]string{}
					for _, r := range refs {
						req.Resolutions[fmt.Sprintf("%s:%d", r.Type, r.ID)] = res
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
	cmd.Flags().BoolVar(&restoreParents, "restore-parents", false, "Also restore deleted parent projects/milestones")
	cmd.Flags().BoolVar(&standalone, "standalone", false, "Restore items standalone, clearing dangling parent links")
	return cmd
}

func newTrashPurgeCmd() *cobra.Command {
	var batch int
	var yes bool
	cmd := &cobra.Command{
		Use:   "purge [<type:id>...]",
		Short: "Permanently delete items from the recycle bin (owner only)",
		Long: "Permanently delete binned items. This cannot be undone and requires the\n" +
			"workspace owner role. Pass refs like `issue:42`, or --batch <id>.",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
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
					return fmt.Errorf("provide one or more <type:id> refs, or --batch <id>")
				}
				req.Items = refs
				target = fmt.Sprintf("%d item(s)", len(refs))
			}

			if !Confirm(fmt.Sprintf("Permanently delete %s? This cannot be undone.", target), yes) {
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
	AddYesFlag(cmd, &yes)
	return cmd
}

func newTrashEmptyCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "empty",
		Short: "Permanently delete everything in the recycle bin (owner only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if !Confirm("Permanently delete everything in the Trash? This cannot be undone.", yes) {
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
	AddYesFlag(cmd, &yes)
	return cmd
}

func truncateTitle(s string) string {
	const max = 48
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

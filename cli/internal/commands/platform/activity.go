package platform

// `bk activity` reads platform.events, so it stays a bare platform verb — and
// Phase 6 is where it becomes a genuinely cross-app feed (`+ app`,
// `+ subject_urn`). The analytics half of this file moved to
// commands/issues/analytics.go in Phase 5: it slices by issue status, priority,
// label and assignee, which is one app's vocabulary.

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newActivityCmd() *cobra.Command {
	var limit, cursor int
	cmd := &cobra.Command{
		Use:         "activity",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/activity"},
		Short:       "Show the workspace activity feed",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			var cur *int
			if cmd.Flags().Changed("cursor") {
				cur = &cursor
			}
			items, nextCursor, err := c.Activity(limit, cur)
			if err != nil {
				return err
			}

			data := any(items)
			if format != output.FormatTable && nextCursor != nil {
				data = map[string]any{"data": items, "next_cursor": nextCursor}
			}

			return output.Render(format, data, func(w io.Writer) error {
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no activity)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WHEN\tWHO\tACTION\tENTITY\tID")
				for _, a := range items {
					entID := "—"
					if a.EntityID != nil {
						// issue/task/project ids are the workspace #number
						switch a.EntityType {
						case "issue", "task", "project":
							entID = fmt.Sprintf("#%d", *a.EntityID)
						default:
							entID = fmt.Sprintf("%d", *a.EntityID)
						}
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
						cmdutil.DerefOr(a.OccurredAt, ""), cmdutil.DerefOr(a.ActorName, "—"),
						a.Action, a.EntityType, entID)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if nextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "next page: --cursor=%d\n", *nextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 50, "Max items to return")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Cursor (last event id seen) for pagination")
	return cmd
}

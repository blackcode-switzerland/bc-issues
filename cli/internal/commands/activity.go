package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newActivityCmd() *cobra.Command {
	var limit, offset int
	cmd := &cobra.Command{
		Use:   "activity",
		Short: "Show the global activity feed",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			items, err := c.Activity(limit, offset)
			if err != nil {
				return err
			}
			return output.Render(format, items, func(w io.Writer) error {
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no activity)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WHEN\tWHO\tOPERATION\tTABLE\tRECORD")
				for _, a := range items {
					recID := "—"
					if a.RecordID != nil {
						recID = fmt.Sprintf("%d", *a.RecordID)
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
						derefOr(a.CreatedAt, ""), derefOr(a.UserName, "—"),
						a.OperationType, a.TableName, recID)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 50, "Max items to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "Offset for pagination")
	return cmd
}

func newAnalyticsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "analytics",
		Short: "Show server analytics (admin-only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			raw, err := c.AnalyticsRaw()
			if err != nil {
				return err
			}
			var generic any
			if err := json.Unmarshal(raw, &generic); err != nil {
				return fmt.Errorf("decode analytics: %w", err)
			}
			return output.Render(format, generic, func(w io.Writer) error {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(generic)
			})
		},
	}
}

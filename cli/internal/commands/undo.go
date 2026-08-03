package commands

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newUndoCmd() *cobra.Command {
	var count int
	var yes bool
	var showLog bool
	cmd := &cobra.Command{
		Use:         "undo",
		Annotations: map[string]string{"routes": "POST /api/undo,GET /api/undo"},
		Short:       "Undo the last N operations you performed (max 10)",
		RunE: func(cmd *cobra.Command, args []string) error {
			// --log is a read: show what would be rolled back, change nothing.
			if showLog {
				format, err := output.Resolve(cmd)
				if err != nil {
					return err
				}
				c, err := newClient()
				if err != nil {
					return err
				}
				logJSON, err := c.UndoLog()
				if err != nil {
					return err
				}
				return output.Render(format, logJSON, func(w io.Writer) error {
					_, err := fmt.Fprintln(w, string(logJSON))
					return err
				})
			}
			if count < 1 {
				count = 1
			}
			if count > 10 {
				count = 10
			}
			if !Confirm(fmt.Sprintf("Undo your last %d operation(s)?", count), yes) {
				return fmt.Errorf("aborted")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			res, err := c.Undo(count)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				fmt.Fprintf(w, "undone %d operation(s)\n", res.UndoneCount)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&count, "count", 1, "How many operations to roll back (server clamps to limits.undo_max_count in `bk meta`)")
	cmd.Flags().BoolVar(&showLog, "log", false, "Show the recent operation log instead of undoing anything")
	AddYesFlag(cmd, &yes)
	return cmd
}

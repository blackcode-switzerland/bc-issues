package commands

import (
	"fmt"
	"io"

	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newUndoCmd() *cobra.Command {
	var count int
	var yes bool
	cmd := &cobra.Command{
		Use:   "undo",
		Short: "Undo the last N operations you performed (max 10)",
		RunE: func(cmd *cobra.Command, args []string) error {
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
	cmd.Flags().IntVar(&count, "count", 1, "How many operations to roll back (1-10)")
	AddYesFlag(cmd, &yes)
	return cmd
}

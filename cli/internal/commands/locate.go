package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newLocateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "locate <issue|task|project> <id>",
		Short: "Resolve an entity id to its workspace (works across workspaces)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			entityType := args[0]
			switch entityType {
			case "issue", "task", "project":
			default:
				return fmt.Errorf("invalid type %q (want: issue | task | project)", entityType)
			}
			id, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			res, err := c.Locate(entityType, id)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				fmt.Fprintf(w, "type:           %s\n", res.Type)
				fmt.Fprintf(w, "id:             %d\n", res.ID)
				fmt.Fprintf(w, "workspace_id:   %d\n", res.WorkspaceID)
				fmt.Fprintf(w, "workspace_slug: %s\n", res.WorkspaceSlug)
				return nil
			})
		},
	}
}

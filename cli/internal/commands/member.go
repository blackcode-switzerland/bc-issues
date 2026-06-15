package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newMemberCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "member",
		Short: "Manage members of the active workspace",
	}
	cmd.AddCommand(
		newMemberListCmd(),
		newMemberRemoveCmd(),
		newMemberLeaveCmd(),
	)
	return cmd
}

func newMemberListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List members of the active workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
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
			members, err := c.ListWorkspaceMembers(ws)
			if err != nil {
				return err
			}
			return output.Render(format, members, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "USER ID\tEMAIL\tNAME\tROLE")
				for _, m := range members {
					name := "—"
					if m.Name != nil {
						name = *m.Name
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n", m.UserID, m.Email, name, m.Role)
				}
				return tw.Flush()
			})
		},
	}
}

func newMemberRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "remove <user_id>",
		Short: "Remove a member from the active workspace (owner only)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			userID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid user_id %q", args[0])
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.RemoveWorkspaceMember(ws, userID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed user %d from %s\n", userID, ws)
			return nil
		},
	}
}

func newMemberLeaveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "leave",
		Short: "Leave the active workspace (not allowed for owner)",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.LeaveWorkspace(ws); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "left %s\n", ws)
			return nil
		},
	}
}

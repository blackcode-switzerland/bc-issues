package commands

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newInviteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "invite",
		Short: "Manage workspace invitations",
	}
	cmd.AddCommand(
		newInviteSendCmd(),
		newInviteListCmd(),
		newInviteRevokeCmd(),
		newInviteAcceptCmd(),
		newInviteDeclineCmd(),
		newInvitePendingCmd(),
	)
	return cmd
}

func newInviteSendCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "send <email>",
		Short: "Invite a teammate to the active workspace by email",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			res, err := c.SendInvitation(ws, args[0])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Invitation sent to %s.\n", res.Invitation.Email)
			if res.InviteeHasAccount {
				fmt.Fprintln(cmd.OutOrStdout(), "They'll see it in their inbox immediately.")
			} else {
				inviteURL := fmt.Sprintf("%s/invitations/%s",
					strings.TrimRight(cfg.Server, "/"), res.Invitation.Token)
				fmt.Fprintf(cmd.OutOrStdout(), "Share this link:\n  %s\n", inviteURL)
			}
			return nil
		},
	}
}

func newInviteListCmd() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List invitations for the active workspace (owner only)",
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
			rows, err := c.ListInvitations(ws, all)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tEMAIL\tSTATUS\tEXPIRES\tCREATED")
				for _, inv := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						inv.ID, inv.Email, inv.Status, inv.ExpiresAt, inv.CreatedAt)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "Include accepted/revoked/expired (not just pending)")
	return cmd
}

func newInviteRevokeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke a pending invitation",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.RevokeInvitation(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "invitation %d revoked\n", id)
			return nil
		},
	}
}

func newInviteAcceptCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "accept <token>",
		Short: "Accept an invitation by its token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			if err := c.AcceptInvitation(args[0]); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "accepted")
			return nil
		},
	}
}

func newInviteDeclineCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "decline <token>",
		Short: "Decline an invitation by its token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			if err := c.DeclineInvitation(args[0]); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "declined")
			return nil
		},
	}
}

func newInvitePendingCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "pending",
		Short: "List invitations pending for your email",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			rows, err := c.ListPendingInvitationsForMe()
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WORKSPACE\tEMAIL\tEXPIRES\tTOKEN")
				for _, inv := range rows {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						inv.WorkspaceName, inv.Email, inv.ExpiresAt, inv.Token)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no pending invitations)")
				}
				return nil
			})
		},
	}
}

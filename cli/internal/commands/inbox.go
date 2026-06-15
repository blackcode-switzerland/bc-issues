package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newInboxCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "inbox",
		Short: "Per-user notifications (invitations, mentions, assignments, status changes)",
	}
	cmd.AddCommand(
		newInboxListCmd(),
		newInboxReadCmd(),
		newInboxArchiveCmd(),
		newInboxUnarchiveCmd(),
	)
	return cmd
}

func newInboxListCmd() *cobra.Command {
	var unread bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List inbox messages",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			page, err := c.ListInbox(unread, false)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tTYPE\tWORKSPACE\tTITLE\tSTATE\tWHEN")
				for _, m := range page.Data {
					state := "unread"
					if m.ReadAt != nil {
						state = "read"
					}
					if m.ArchivedAt != nil {
						state = "archived"
					}
					var payload map[string]any
					_ = json.Unmarshal(m.Payload, &payload)
					title, _ := payload["issue_title"].(string)
					if title == "" {
						title, _ = payload["workspace_name"].(string)
					}
					wsName, _ := payload["workspace_name"].(string)
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						m.ID, m.Type, wsName, truncateInbox(title, 40), state, m.CreatedAt)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(inbox empty)")
				}
				fmt.Fprintf(cmd.ErrOrStderr(), "Unread: %d\n", page.UnreadCount)
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&unread, "unread", false, "Only show unread messages")
	return cmd
}

func newInboxReadCmd() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:   "read [id ...] | --all",
		Short: "Mark inbox messages as read",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !all && len(args) == 0 {
				return fmt.Errorf("provide message IDs or use --all")
			}
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.MarkInboxRead(ids, all)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "marked %d read\n", count)
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "Mark all unread messages as read")
	return cmd
}

func newInboxArchiveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "archive <id> [id ...]",
		Short: "Archive inbox messages",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.ArchiveInbox(ids)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "archived %d\n", count)
			return nil
		},
	}
}

func newInboxUnarchiveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unarchive <id> [id ...]",
		Short: "Move archived messages back to inbox",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.UnarchiveInbox(ids)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "unarchived %d\n", count)
			return nil
		},
	}
}

func truncateInbox(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}


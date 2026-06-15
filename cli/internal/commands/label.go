package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newLabelCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "label",
		Short: "Manage labels (workspace-scoped)",
	}
	cmd.AddCommand(
		newLabelListCmd(),
		newLabelCreateCmd(),
		newLabelDeleteCmd(),
		newLabelAttachCmd(),
		newLabelDetachCmd(),
	)
	return cmd
}

func newLabelListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List labels in the active workspace",
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
			labels, err := c.ListLabels(ws)
			if err != nil {
				return err
			}
			return output.Render(format, labels, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tCOLOR\tISSUES")
				for _, l := range labels {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%d\n", l.ID, l.Name, l.Color, l.IssueCount)
				}
				return tw.Flush()
			})
		},
	}
}

func newLabelCreateCmd() *cobra.Command {
	var name, color, description string
	cmd := &cobra.Command{
		Use:   "create --name NAME [--color HEX]",
		Short: "Create a label in the active workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			req := client.CreateLabelRequest{Name: name, Color: color}
			if description != "" {
				req.Description = &description
			}
			label, err := c.CreateLabel(ws, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Created label %s (id %d, color %s)\n",
				label.Name, label.ID, label.Color)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Label name")
	cmd.Flags().StringVar(&color, "color", "#6b7280", "Label color (#rrggbb)")
	cmd.Flags().StringVar(&description, "description", "", "Optional description")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newLabelDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a label (removes it from all issues)",
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
			if err := c.DeleteLabel(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "label %d deleted\n", id)
			return nil
		},
	}
}

func newLabelAttachCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "attach <issue_id> <label_id>",
		Short: "Attach a label to an issue",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.AttachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "attached label %d to issue %d\n", labelID, issueID)
			return nil
		},
	}
}

func newLabelDetachCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "detach <issue_id> <label_id>",
		Short: "Detach a label from an issue",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.DetachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "detached label %d from issue %d\n", labelID, issueID)
			return nil
		},
	}
}

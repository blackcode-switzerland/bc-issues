package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/mustneerar7/blackcode-issues/cli/internal/client"
	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newMilestoneCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "milestone",
		Aliases: []string{"milestones"},
		Short:   "Read milestones",
	}
	cmd.AddCommand(
		newMilestoneListCmd(),
		newMilestoneViewCmd(),
		newMilestoneCreateCmd(),
		newMilestoneEditCmd(),
		newMilestoneDeleteCmd(),
	)
	return cmd
}

func newMilestoneListCmd() *cobra.Command {
	var projectID int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List milestones (optionally filter by --project)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			ms, err := c.ListMilestones(projectID)
			if err != nil {
				return err
			}
			return output.Render(format, ms, milestoneTable(ms, cmd.ErrOrStderr()))
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Filter by project id")
	return cmd
}

func newMilestoneViewCmd() *cobra.Command {
	var includeIssues bool
	cmd := &cobra.Command{
		Use:   "view <id>",
		Short: "Show a milestone",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			m, err := c.GetMilestone(id, includeIssues)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", m.ID)
				fmt.Fprintf(w, "Name:        %s\n", m.Name)
				fmt.Fprintf(w, "Project:     #%d %s\n", m.ProjectID, derefOr(m.ProjectName, ""))
				fmt.Fprintf(w, "Description: %s\n", derefOr(m.Description, "—"))
				fmt.Fprintf(w, "Due:         %s\n", derefOr(m.DueDate, "—"))
				fmt.Fprintf(w, "Issues:      %d completed / %d total\n",
					intOr(m.CompletedIssues, 0), intOr(m.IssueCount, 0))
				if includeIssues && len(m.Issues) > 0 {
					fmt.Fprintln(w, "\nIssues:")
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "  ID\tPRIORITY\tSTATUS\tTITLE")
					for _, i := range m.Issues {
						fmt.Fprintf(tw, "  %d\tP%d\t%s\t%s\n",
							i.ID, i.Priority, i.Status, truncate(i.Title, 60))
					}
					return tw.Flush()
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&includeIssues, "include-issues", false, "Embed the milestone's issues")
	return cmd
}

func newMilestoneCreateCmd() *cobra.Command {
	var projectID int
	var name, description, descriptionFile, dueDate string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a milestone",
		RunE: func(cmd *cobra.Command, args []string) error {
			if projectID == 0 || name == "" {
				return fmt.Errorf("--project and --name are required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			body, err := ReadBody(description, descriptionFile)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			req := client.CreateMilestoneRequest{
				ProjectID:   projectID,
				Name:        name,
				Description: body,
			}
			if dueDate != "" {
				req.DueDate = &dueDate
			}
			m, err := c.CreateMilestone(req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "created milestone #%d %q\n", m.ID, m.Name)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Project id (required)")
	cmd.Flags().StringVar(&name, "name", "", "Milestone name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description (\"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	return cmd
}

func newMilestoneEditCmd() *cobra.Command {
	var name, description, descriptionFile, dueDate string
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Edit a milestone (name, description, due date; use 'none' to clear due date)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req := client.UpdateMilestoneRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("description") || cmd.Flags().Changed("description-file") {
				body, err := ReadBody(description, descriptionFile)
				if err != nil {
					return err
				}
				req.Description = &body
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = StringOrNullJSON(dueDate)
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			m, err := c.UpdateMilestone(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "updated milestone #%d %q\n", m.ID, m.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&description, "description", "", "New description (\"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "New due date YYYY-MM-DD (or 'none')")
	return cmd
}

func newMilestoneDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a milestone",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Delete milestone #%d?", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteMilestone(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted milestone #%d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func milestoneTable(ms []client.Milestone, stderr io.Writer) func(io.Writer) error {
	return func(w io.Writer) error {
		tw := output.Tabwriter(w)
		fmt.Fprintln(tw, "ID\tNAME\tPROJECT\tDUE\tISSUES (DONE/TOTAL)")
		for _, m := range ms {
			fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d/%d\n",
				m.ID, m.Name, derefOr(m.ProjectName, fmt.Sprintf("#%d", m.ProjectID)),
				derefOr(m.DueDate, "—"),
				intOr(m.CompletedIssues, 0), intOr(m.IssueCount, 0))
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(ms) == 0 {
			fmt.Fprintln(stderr, "(no milestones)")
		}
		return nil
	}
}

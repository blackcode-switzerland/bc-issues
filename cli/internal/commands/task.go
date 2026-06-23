package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newTaskCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "task",
		Aliases: []string{"tasks"},
		Short:   "Manage tasks",
	}
	cmd.AddCommand(
		newTaskListCmd(),
		newTaskViewCmd(),
		newTaskCreateCmd(),
		newTaskEditCmd(),
		newTaskDeleteCmd(),
		newTaskCommentCmd(),
		newTaskCommentsCmd(),
	)
	return cmd
}

func newTaskListCmd() *cobra.Command {
	var projectID int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List tasks (optionally filter by --project)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			ms, err := c.ListTasks(projectID)
			if err != nil {
				return err
			}
			return output.Render(format, ms, taskTable(ms, cmd.ErrOrStderr()))
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Filter by project id")
	return cmd
}

func newTaskViewCmd() *cobra.Command {
	var includeIssues bool
	cmd := &cobra.Command{
		Use:   "view <id>",
		Short: "Show a task",
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
			m, err := c.GetTask(id, includeIssues)
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
	cmd.Flags().BoolVar(&includeIssues, "include-issues", false, "Embed the task's issues")
	return cmd
}

func newTaskCreateCmd() *cobra.Command {
	var projectID int
	var name, description, descriptionFile, dueDate string
	var files []string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a task",
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
			body, err = resolveBodyMedia(c, body)
			if err != nil {
				return err
			}
			body, err = embedFiles(c, body, files)
			if err != nil {
				return err
			}
			req := client.CreateTaskRequest{
				ProjectID:   projectID,
				Name:        name,
				Description: body,
			}
			if dueDate != "" {
				req.DueDate = &dueDate
			}
			m, err := c.CreateTask(req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "created task #%d %q\n", m.ID, m.Name)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Project id (required)")
	cmd.Flags().StringVar(&name, "name", "", "Task name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description (\"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	AddFileFlag(cmd, &files)
	return cmd
}

func newTaskEditCmd() *cobra.Command {
	var name, description, descriptionFile, dueDate string
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Edit a task (name, description, due date; use 'none' to clear due date)",
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
			req := client.UpdateTaskRequest{}
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
			if req.Description != nil {
				resolved, err := resolveBodyMedia(c, *req.Description)
				if err != nil {
					return err
				}
				req.Description = &resolved
			}
			m, err := c.UpdateTask(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "updated task #%d %q\n", m.ID, m.Name)
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

func newTaskDeleteCmd() *cobra.Command {
	var yes, cascade, detach bool
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Move a task to the Trash",
		Long: "Move a task to the recycle bin. Restore it later with `bk trash restore`.\n\n" +
			"Attached issues: by default they stay active and are unlinked from the\n" +
			"task (--detach). Pass --cascade to move them to the Trash too so they\n" +
			"can be restored as a group.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if cascade && detach {
				return fmt.Errorf("--cascade and --detach are mutually exclusive")
			}
			mode := ""
			if cascade {
				mode = "cascade"
			} else if detach {
				mode = "detach"
			}
			prompt := fmt.Sprintf("Move task #%d to Trash?", id)
			if cascade {
				prompt = fmt.Sprintf("Move task #%d and its issues to Trash?", id)
			}
			if !Confirm(prompt, yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteTask(id, mode); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "moved task #%d to Trash\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	cmd.Flags().BoolVar(&cascade, "cascade", false, "Also move attached issues to Trash")
	cmd.Flags().BoolVar(&detach, "detach", false, "Keep attached issues active, unlinked (default)")
	return cmd
}

func newTaskCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:   "comment <task-id>",
		Short: "Post a comment on a task",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
			}
			content, err := ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			if content == "" {
				return fmt.Errorf("comment body is empty")
			}
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
			content, err = resolveBodyMedia(c, content)
			if err != nil {
				return err
			}
			cm, err := c.CreateTaskComment(ws, id, content)
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d posted on task #%d\n", cm.ID, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "Comment text (\"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	return cmd
}

func newTaskCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "comments <task-id>",
		Short: "List comments on a task",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
			}
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
			comments, err := c.ListTaskComments(ws, id)
			if err != nil {
				return err
			}
			return output.Render(format, comments, renderCommentList(comments, cmd.ErrOrStderr()))
		},
	}
}

func taskTable(ms []client.Task, stderr io.Writer) func(io.Writer) error {
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
			fmt.Fprintln(stderr, "(no tasks)")
		}
		return nil
	}
}

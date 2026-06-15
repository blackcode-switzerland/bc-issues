package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newIssueCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "issue",
		Short: "Manage issues",
	}
	cmd.AddCommand(
		newIssueListCmd(),
		newIssueViewCmd(),
		newIssueCreateCmd(),
		newIssueEditCmd(),
		newIssueDeleteCmd(),
		newIssueAssignCmd(),
		newIssueUnassignCmd(),
		newIssueCommentCmd(),
		newIssueCommentsCmd(),
		newIssueEditCommentCmd(),
		newIssueDeleteCommentCmd(),
		newIssueActivityCmd(),
		newIssueAttachCmd(),
		newIssueDetachCmd(),
		newIssueAttachmentsCmd(),
		newIssueWatchCmd(),
		newIssueUnwatchCmd(),
	)
	return cmd
}

type issueListFlags struct {
	projectID int
	status    string
	assignee  string
	mine      bool
	limit     int
	cursor    int
	cursorSet bool
}

func newIssueListCmd() *cobra.Command {
	var f issueListFlags
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List issues",
		RunE: func(cmd *cobra.Command, args []string) error {
			f.cursorSet = cmd.Flags().Changed("cursor")
			return runIssueList(cmd, f)
		},
	}
	cmd.Flags().IntVar(&f.projectID, "project", 0, "Filter by project id")
	cmd.Flags().StringVar(&f.status, "status", "", "Filter by status (client-side)")
	cmd.Flags().StringVar(&f.assignee, "assignee", "", "Filter by assignee id, email, or 'me' (client-side)")
	cmd.Flags().BoolVar(&f.mine, "mine", false, "Show only issues assigned to the current user")
	cmd.Flags().IntVar(&f.limit, "limit", 50, "Page size (1-200, paginated mode)")
	cmd.Flags().IntVar(&f.cursor, "cursor", 0, "Cursor (last id seen) for pagination")
	return cmd
}

func runIssueList(cmd *cobra.Command, f issueListFlags) error {
	format, err := output.Resolve(cmd)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	c := client.New(cfg.Server, cfg.Token)

	opts := client.ListIssuesOpts{ProjectID: f.projectID, Limit: f.limit}
	if f.cursorSet {
		opts.Cursor = &f.cursor
	}
	page, err := c.ListIssues(opts)
	if err != nil {
		return err
	}

	filtered, err := filterIssues(c, cfg, page.Data, f)
	if err != nil {
		return err
	}

	out := any(filtered)
	if format != output.FormatTable && page.NextCursor != nil {
		out = struct {
			Data       []client.Issue `json:"data" yaml:"data"`
			NextCursor *int           `json:"next_cursor" yaml:"next_cursor"`
		}{filtered, page.NextCursor}
	}

	return output.Render(format, out, func(w io.Writer) error {
		tw := output.Tabwriter(w)
		fmt.Fprintln(tw, "ID\tPRIORITY\tSTATUS\tTITLE\tASSIGNEE")
		for _, i := range filtered {
			fmt.Fprintf(tw, "%d\tP%d\t%s\t%s\t%s\n",
				i.ID, i.Priority, i.Status, truncate(i.Title, 60), issueAssigneeLabel(i.Assignees))
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(filtered) == 0 {
			fmt.Fprintln(cmd.ErrOrStderr(), "(no issues)")
		}
		if page.NextCursor != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "next page: --cursor=%d\n", *page.NextCursor)
		}
		return nil
	})
}

func filterIssues(c *client.Client, cfg *config.Config, issues []client.Issue, f issueListFlags) ([]client.Issue, error) {
	status := strings.ToLower(strings.TrimSpace(f.status))
	assignee := strings.TrimSpace(f.assignee)

	var assigneeID int
	var assigneeEmail string
	resolveAssignee := assignee != "" || f.mine
	if resolveAssignee {
		ref := assignee
		if f.mine || strings.EqualFold(assignee, "me") {
			assigneeID = cfg.UserID
			ref = ""
		}
		if ref != "" {
			if id, err := strconv.Atoi(ref); err == nil {
				assigneeID = id
			} else if strings.Contains(ref, "@") {
				assigneeEmail = strings.ToLower(ref)
				users, err := c.ListUsers()
				if err != nil {
					return nil, fmt.Errorf("resolve assignee email: %w", err)
				}
				for _, u := range users {
					if strings.EqualFold(u.Email, assigneeEmail) {
						assigneeID = u.ID
						break
					}
				}
				if assigneeID == 0 {
					return nil, fmt.Errorf("no user found with email %q", ref)
				}
			} else {
				users, err := c.ListUsers()
				if err != nil {
					return nil, fmt.Errorf("resolve assignee name: %w", err)
				}
				for _, u := range users {
					if u.Name != nil && strings.EqualFold(*u.Name, ref) {
						assigneeID = u.ID
						break
					}
				}
				if assigneeID == 0 {
					return nil, fmt.Errorf("no user found matching %q", ref)
				}
			}
		}
	}

	var out []client.Issue
	for _, i := range issues {
		if status != "" && !strings.EqualFold(i.Status, status) {
			continue
		}
		if resolveAssignee {
			found := false
			for _, a := range i.Assignees {
				if a.ID == assigneeID {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		out = append(out, i)
	}
	return out, nil
}

func newIssueViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view <id>",
		Short: "Show a single issue",
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
			iss, err := c.GetIssue(id)
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", iss.ID)
				fmt.Fprintf(w, "Title:       %s\n", iss.Title)
				fmt.Fprintf(w, "Project:     #%d %s\n", iss.ProjectID, derefOr(iss.ProjectName, ""))
				fmt.Fprintf(w, "Status:      %s\n", iss.Status)
				fmt.Fprintf(w, "Priority:    P%d\n", iss.Priority)
				fmt.Fprintf(w, "Assignees:   %s\n", issueAssigneeLabel(iss.Assignees))
				if iss.MilestoneName != nil {
					fmt.Fprintf(w, "Milestone:   %s\n", *iss.MilestoneName)
				}
				if iss.DueDate != nil {
					fmt.Fprintf(w, "Due:         %s\n", *iss.DueDate)
				}
				if iss.Description != nil && *iss.Description != "" {
					fmt.Fprintf(w, "\nDescription:\n%s\n", *iss.Description)
				}
				return nil
			})
		},
	}
}

func newIssueCreateCmd() *cobra.Command {
	var projectID, priority int
	var title, description, descriptionFile, status, attach string
	var assignee, milestone, startDate, dueDate string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an issue",
		RunE: func(cmd *cobra.Command, args []string) error {
			if projectID == 0 || title == "" {
				return fmt.Errorf("--project and --title are required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			body, err := ReadBody(description, descriptionFile)
			if err != nil {
				return err
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c := client.New(cfg.Server, cfg.Token)

			req := client.CreateIssueRequest{
				ProjectID:   projectID,
				Title:       title,
				Description: body,
				Status:      status,
				Priority:    priority,
			}
			if assignee != "" && !strings.EqualFold(assignee, "none") {
				uid, err := ResolveUserID(assignee, c, cfg)
				if err != nil {
					return err
				}
				if uid > 0 {
					req.AssigneeIDs = []int{uid}
				}
			}
			if milestone != "" {
				raw, err := PlainIntOrNullJSON(milestone)
				if err != nil {
					return err
				}
				req.MilestoneID = raw
			}
			if startDate != "" {
				req.StartDate = &startDate
			}
			if dueDate != "" {
				req.DueDate = &dueDate
			}

			iss, err := c.CreateIssue(req)
			if err != nil {
				return err
			}

			if attach != "" {
				up, err := c.UploadFile(attach)
				if err != nil {
					return fmt.Errorf("upload failed: %w", err)
				}
				if _, err := c.AttachToIssue(iss.ID, up); err != nil {
					return fmt.Errorf("attach failed: %w", err)
				}
				fmt.Fprintf(os.Stderr, "attached %s -> %s\n", up.Filename, up.URL)
			}

			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "created #%d %q\n", iss.ID, iss.Title)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Project id (required)")
	cmd.Flags().StringVar(&title, "title", "", "Issue title (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description (use \"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&status, "status", "", "Status (backlog/todo/in_progress/blocked/in_review/done/cancelled)")
	cmd.Flags().IntVar(&priority, "priority", 0, "Priority 1-5 (1=urgent)")
	cmd.Flags().StringVar(&attach, "attach", "", "Path to a file to attach")
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, or 'me')")
	cmd.Flags().StringVar(&milestone, "milestone", "", "Milestone id")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	return cmd
}

func newIssueEditCmd() *cobra.Command {
	var status, title, description, descriptionFile string
	var priority int
	var assignee, milestone, startDate, dueDate string
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Edit an issue (status, title, priority, description, assignee, milestone, dates)",
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
			req := client.UpdateIssueRequest{}
			if cmd.Flags().Changed("status") {
				req.Status = &status
			}
			if cmd.Flags().Changed("title") {
				req.Title = &title
			}
			if cmd.Flags().Changed("description") || cmd.Flags().Changed("description-file") {
				body, err := ReadBody(description, descriptionFile)
				if err != nil {
					return err
				}
				req.Description = &body
			}
			if cmd.Flags().Changed("priority") {
				req.Priority = &priority
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c := client.New(cfg.Server, cfg.Token)
			if cmd.Flags().Changed("assignee") {
				if strings.EqualFold(assignee, "none") || strings.EqualFold(assignee, "null") || strings.EqualFold(assignee, "clear") || strings.EqualFold(assignee, "unset") {
					req.AssigneeIDs = []byte("[]")
				} else {
					uid, err := ResolveUserID(assignee, c, cfg)
					if err != nil {
						return err
					}
					encoded, _ := json.Marshal([]int{uid})
					req.AssigneeIDs = encoded
				}
			}
			if cmd.Flags().Changed("milestone") {
				raw, err := PlainIntOrNullJSON(milestone)
				if err != nil {
					return err
				}
				req.MilestoneID = raw
			}
			if cmd.Flags().Changed("start-date") {
				req.StartDate = StringOrNullJSON(startDate)
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = StringOrNullJSON(dueDate)
			}
			iss, err := c.UpdateIssue(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "updated #%d (status=%s priority=P%d)\n", iss.ID, iss.Status, iss.Priority)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "New status")
	cmd.Flags().StringVar(&title, "title", "", "New title")
	cmd.Flags().StringVar(&description, "description", "", "New description (\"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().IntVar(&priority, "priority", 0, "New priority (1-5)")
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, 'me', or 'none' to clear)")
	cmd.Flags().StringVar(&milestone, "milestone", "", "Milestone id (or 'none' to clear)")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD (or 'none')")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD (or 'none')")
	return cmd
}

func newIssueDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete an issue (project owners/admins only)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Delete issue #%d?", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteIssue(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted issue #%d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueAssignCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "assign <id> <user>",
		Short: "Assign an issue (user is id, email, name, or 'me')",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c := client.New(cfg.Server, cfg.Token)
			uid, err := ResolveUserID(args[1], c, cfg)
			if err != nil {
				return err
			}
			// Fetch current assignees and append the new one.
			current, err := c.GetIssue(id)
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(current.Assignees)+1)
			for _, a := range current.Assignees {
				ids = append(ids, a.ID)
			}
			alreadyAssigned := false
			for _, existing := range ids {
				if existing == uid {
					alreadyAssigned = true
					break
				}
			}
			if !alreadyAssigned {
				ids = append(ids, uid)
			}
			encoded, _ := json.Marshal(ids)
			iss, err := c.UpdateIssue(id, client.UpdateIssueRequest{AssigneeIDs: encoded})
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "issue #%d assigned: %s\n", iss.ID, issueAssigneeLabel(iss.Assignees))
				return nil
			})
		},
	}
	return cmd
}

func newIssueUnassignCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unassign <id>",
		Short: "Clear the assignee on an issue",
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
			c, err := newClient()
			if err != nil {
				return err
			}
			iss, err := c.UpdateIssue(id, client.UpdateIssueRequest{AssigneeIDs: []byte("[]")})
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "issue #%d unassigned\n", iss.ID)
				return nil
			})
		},
	}
}

func newIssueCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:   "comment <id>",
		Short: "Post a comment on an issue (use --body \"-\" for stdin)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			content, err := ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
				return fmt.Errorf("comment body is empty")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			cm, err := c.CreateComment(id, client.CreateCommentRequest{Content: content})
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d posted on issue #%d\n", cm.ID, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "Comment text (use \"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from a file")
	return cmd
}

func newIssueEditCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:   "edit-comment <issue-id> <comment-id>",
		Short: "Edit a comment on an issue (author only)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue id: %w", err)
			}
			commentID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid comment id: %w", err)
			}
			content, err := ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
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
			cm, err := c.EditComment(ws, commentID, content)
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d updated\n", cm.ID)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "New comment text (\"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	return cmd
}

func newIssueDeleteCommentCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete-comment <issue-id> <comment-id>",
		Short: "Delete a comment (author only)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue id: %w", err)
			}
			commentID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid comment id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Delete comment #%d?", commentID), yes) {
				return fmt.Errorf("aborted")
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.DeleteComment(ws, commentID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted comment #%d\n", commentID)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueWatchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "watch <id>",
		Short: "Subscribe to notifications on an issue",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.WatchIssue(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "watching issue #%d\n", id)
			return nil
		},
	}
}

func newIssueUnwatchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unwatch <id>",
		Short: "Unsubscribe from notifications on an issue",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := requireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.UnwatchIssue(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "no longer watching issue #%d\n", id)
			return nil
		},
	}
}

func newIssueAttachCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "attach <id>",
		Short: "Upload and attach a file to an issue",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if file == "" {
				return fmt.Errorf("--file is required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			up, err := c.UploadFile(file)
			if err != nil {
				return fmt.Errorf("upload failed: %w", err)
			}
			att, err := c.AttachToIssue(id, up)
			if err != nil {
				return fmt.Errorf("attach failed: %w", err)
			}
			return output.Render(format, att, func(w io.Writer) error {
				fmt.Fprintf(w, "attached %s (#%d) -> %s\n", att.Filename, att.ID, att.FileURL)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to file to upload (required)")
	return cmd
}

func newIssueDetachCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "detach <issue-id> <attachment-id>",
		Short: "Delete an attachment from an issue",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue id: %w", err)
			}
			attID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid attachment id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Delete attachment #%d on issue #%d?", attID, issueID), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteAttachment(issueID, attID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted attachment #%d\n", attID)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "comments <id>",
		Short: "List comments on an issue",
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
			comments, err := c.ListIssueComments(id)
			if err != nil {
				return err
			}
			return output.Render(format, comments, func(w io.Writer) error {
				if len(comments) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no comments)")
					return nil
				}
				for _, cm := range comments {
					author := derefOr(cm.AuthorName, "—")
					ts := derefOr(cm.CreatedAt, "")
					fmt.Fprintf(w, "── %s · %s ─────\n%s\n\n", author, ts, cm.Content)
				}
				return nil
			})
		},
	}
}

func newIssueActivityCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "activity <id>",
		Short: "Show activity (comments + changes) on an issue",
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
			items, err := c.ListIssueActivity(id)
			if err != nil {
				return err
			}
			return output.Render(format, items, func(w io.Writer) error {
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no activity)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WHEN\tWHO\tTYPE\tDETAIL")
				for _, a := range items {
					detail := ""
					switch a.Type {
					case "comment":
						detail = truncate(derefOr(a.Content, ""), 80)
					case "change":
						detail = derefOr(a.OperationType, "—")
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						derefOr(a.CreatedAt, ""), derefOr(a.UserName, "—"), a.Type, detail)
				}
				return tw.Flush()
			})
		},
	}
}

func newIssueAttachmentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "attachments <id>",
		Short: "List attachments on an issue",
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
			atts, err := c.ListIssueAttachments(id)
			if err != nil {
				return err
			}
			return output.Render(format, atts, func(w io.Writer) error {
				if len(atts) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no attachments)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tFILENAME\tSIZE\tMIME\tURL")
				for _, a := range atts {
					size := "—"
					if a.FileSize != nil {
						size = humanBytes(*a.FileSize)
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n", a.ID, a.Filename, size, a.MimeType, a.FileURL)
				}
				return tw.Flush()
			})
		},
	}
}

func truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

// ResolveUserID resolves a user reference (id, email, display name, or "me")
// to a numeric user ID. Does not accept "none"/"null" — callers handle those.
func ResolveUserID(ref string, c *client.Client, cfg *config.Config) (int, error) {
	return ResolveUserRef(c, cfg, ref)
}

// issueAssigneeLabel formats the assignees list for one-line display.
func issueAssigneeLabel(assignees []client.IssueAssignee) string {
	if len(assignees) == 0 {
		return "—"
	}
	names := make([]string, 0, len(assignees))
	for _, a := range assignees {
		if a.Name != nil && *a.Name != "" {
			names = append(names, *a.Name)
		} else {
			names = append(names, a.Email)
		}
	}
	return strings.Join(names, ", ")
}

func humanBytes(n int) string {
	const u = 1024
	if n < u {
		return fmt.Sprintf("%dB", n)
	}
	div, exp := int64(u), 0
	for x := int64(n) / u; x >= u; x /= u {
		div *= u
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(n)/float64(div), "KMGTPE"[exp])
}

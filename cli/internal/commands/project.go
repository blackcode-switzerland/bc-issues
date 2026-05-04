package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/mustneerar7/blackcode-issues/cli/internal/client"
	"github.com/mustneerar7/blackcode-issues/cli/internal/config"
	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newProjectCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "project",
		Short: "Manage projects",
	}
	cmd.AddCommand(
		newProjectListCmd(),
		newProjectViewCmd(),
		newProjectMembersCmd(),
		newProjectIssuesCmd(),
		newProjectMilestonesCmd(),
		newProjectCreateCmd(),
		newProjectEditCmd(),
		newProjectDeleteCmd(),
		newProjectAddMemberCmd(),
		newProjectRemoveMemberCmd(),
	)
	return cmd
}

func newProjectListCmd() *cobra.Command {
	var limit, cursor int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List projects you are a member of",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			opts := client.ListProjectsOpts{Limit: limit}
			if cmd.Flags().Changed("cursor") {
				opts.Cursor = &cursor
			}
			page, err := c.ListProjectsPage(opts)
			if err != nil {
				return err
			}

			data := any(page.Data)
			if format != output.FormatTable && page.NextCursor != nil {
				data = page
			}

			return output.Render(format, data, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tSTATUS\tROLE\tISSUES (OPEN/TOTAL)")
				for _, p := range page.Data {
					status := derefOr(p.Status, "—")
					role := derefOr(p.MemberRole, "—")
					open := intOr(p.OpenIssues, 0)
					total := intOr(p.IssueCount, 0)
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d/%d\n", p.ID, p.Name, status, role, open, total)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no projects)")
				}
				if page.NextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "next page: --cursor=%d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 0, "Page size (paginated mode)")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Cursor (last id seen) for pagination")
	return cmd
}

func newProjectViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view <id>",
		Short: "Show a single project",
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
			p, err := c.GetProject(id)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", p.ID)
				fmt.Fprintf(w, "Name:        %s\n", p.Name)
				fmt.Fprintf(w, "Status:      %s\n", derefOr(p.Status, "—"))
				fmt.Fprintf(w, "Description: %s\n", derefOr(p.Description, "—"))
				if p.CreatedAt != nil {
					fmt.Fprintf(w, "Created:     %s\n", *p.CreatedAt)
				}
				return nil
			})
		},
	}
}

func newProjectMembersCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "members <project-id>",
		Short: "List members of a project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			members, err := c.ListProjectMembers(id)
			if err != nil {
				return err
			}
			return output.Render(format, members, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "USER ID\tNAME\tEMAIL\tROLE")
				for _, m := range members {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n",
						m.UserID, derefOr(m.Name, "—"), m.Email, m.Role)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(members) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no members)")
				}
				return nil
			})
		},
	}
}

func newProjectIssuesCmd() *cobra.Command {
	var status, assignee string
	var limit, cursor int
	cmd := &cobra.Command{
		Use:   "issues <project-id>",
		Short: "List issues for a project (optionally filter by status/assignee)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			return runIssueList(cmd, issueListFlags{
				projectID: id,
				status:    status,
				assignee:  assignee,
				limit:     limit,
				cursor:    cursor,
			})
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "Filter by status (client-side)")
	cmd.Flags().StringVar(&assignee, "assignee", "", "Filter by assignee id, email, or 'me' (client-side)")
	cmd.Flags().IntVar(&limit, "limit", 50, "Page size")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Cursor for pagination")
	return cmd
}

func newProjectMilestonesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "milestones <project-id>",
		Short: "List milestones for a project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			ms, err := c.ListMilestones(id)
			if err != nil {
				return err
			}
			return output.Render(format, ms, milestoneTable(ms, cmd.ErrOrStderr()))
		},
	}
}

func newProjectCreateCmd() *cobra.Command {
	var name, description, descriptionFile string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new project",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
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
			p, err := c.CreateProject(client.CreateProjectRequest{
				Name:        name,
				Description: body,
			})
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "created #%d %q\n", p.ID, p.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Project name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Project description (use \"-\" to read stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from a file")
	return cmd
}

func newProjectEditCmd() *cobra.Command {
	var name, description, descriptionFile, status string
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Edit a project (name, description, status)",
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
			req := client.UpdateProjectRequest{}
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
			if cmd.Flags().Changed("status") {
				req.Status = &status
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			p, err := c.UpdateProject(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "updated #%d %q\n", p.ID, p.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&description, "description", "", "New description (use \"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&status, "status", "", "New status (active, archived, ...)")
	return cmd
}

func newProjectDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a project (owner only)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Delete project #%d? This cannot be undone.", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteProject(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted project #%d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newProjectAddMemberCmd() *cobra.Command {
	var email, role string
	cmd := &cobra.Command{
		Use:   "add-member <project-id>",
		Short: "Add a member to a project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			if email == "" {
				return fmt.Errorf("--email is required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			m, err := c.AddProjectMember(id, client.AddMemberRequest{Email: email, Role: role})
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "added %s as %s to project #%d\n", m.Email, m.Role, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&email, "email", "", "Email of the user to add (must already be registered)")
	cmd.Flags().StringVar(&role, "role", "member", "owner | admin | member | viewer")
	return cmd
}

func newProjectRemoveMemberCmd() *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:   "remove-member <project-id>",
		Short: "Remove a member from a project",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			if userRef == "" {
				return fmt.Errorf("--user is required (id, email, or name)")
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c := client.New(cfg.Server, cfg.Token)
			uid, err := ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if !Confirm(fmt.Sprintf("Remove user #%d from project #%d?", uid, id), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.RemoveProjectMember(id, uid); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed user #%d from project #%d\n", uid, id)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "user", "", "User to remove (id, email, or name)")
	AddYesFlag(cmd, &yes)
	return cmd
}

func newClient() (*client.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	return client.New(cfg.Server, cfg.Token), nil
}

func derefOr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return *s
}

func intOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}

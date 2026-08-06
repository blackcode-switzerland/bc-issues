package appverbs

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk <app> label` — label CRUD, workspace-scoped.
//
// What is HERE is app-agnostic: a label row belongs to the workspace, and the
// routes are the shared `/api/workspaces/{ws}/labels…` ones.
//
// APP SCOPE (D-14, migration 0043). `platform.labels.app` is what makes the app
// segment in this spelling mean something: each deployment serves the labels
// scoped to itself PLUS the shared ones (`app IS NULL`, which is every label
// that predates the column), and creating one here stamps this app. So
// `bk sales label list` and `bk issues label list` genuinely differ — the
// scoping is done by the SERVER the group's pin routes to, not by a flag here,
// which is why there is no --app on any of these commands and must not be.
//
// What is NOT here is attach/detach. Attaching a label names an ENTITY — an
// issue, a prospect — and posts to that app's own route, so each app builds its
// own attach/detach and adds them to this group (see
// cli/internal/commands/issues/appverbs.go). Trying to share those would mean
// this package knowing another app's nouns, which is the boundary the whole
// package split exists to hold.
func newLabelCmd(cfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "label",
		Short: fmt.Sprintf("Manage %s labels (workspace-scoped)", cfg.App),
		Long: fmt.Sprintf(`Labels in the active workspace, as %[1]s sees them.

A label is either scoped to one app or SHARED across every app in the workspace.
This group shows %[1]s's own labels and the shared ones; another app's are not
listed and cannot be attached here. A label created here is scoped to %[1]s.`, cfg.App),
	}
	cmd.AddCommand(
		newLabelListCmd(),
		newLabelViewCmd(),
		newLabelCreateCmd(),
		newLabelEditCmd(),
		newLabelDeleteCmd(),
	)
	return cmd
}

func newLabelViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/labels/{id}"},
		Short:       "Show a label",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			l, err := c.GetLabel(ws, id)
			if err != nil {
				return err
			}
			return output.Render(format, l, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", l.ID)
				fmt.Fprintf(w, "Name:        %s\n", l.Name)
				fmt.Fprintf(w, "Color:       %s\n", l.Color)
				fmt.Fprintf(w, "Scope:       %s\n", l.Scope())
				fmt.Fprintf(w, "Description: %s\n", cmdutil.DerefOr(l.Description, "—"))
				return nil
			})
		},
	}
}

func newLabelListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/labels"},
		Short:       "List labels in the active workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			labels, err := c.ListLabels(ws)
			if err != nil {
				return err
			}
			return output.Render(format, labels, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tCOLOR\tSCOPE\tISSUES")
				for _, l := range labels {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d\n", l.ID, l.Name, l.Color, l.Scope(), l.IssueCount)
				}
				return tw.Flush()
			})
		},
	}
}

func newLabelCreateCmd() *cobra.Command {
	var name, color, description string
	cmd := &cobra.Command{
		Use:         "create --name NAME [--color HEX]",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/labels"},
		Short:       "Create a label in the active workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
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
			fmt.Fprintf(cmd.OutOrStdout(), "Created label %s (id %d, color %s, scope %s)\n",
				label.Name, label.ID, label.Color, label.Scope())
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Label name")
	cmd.Flags().StringVar(&color, "color", "#6b7280", "Label color (#rrggbb)")
	cmd.Flags().StringVar(&description, "description", "", "Optional description")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

// label edit — renaming/recolouring a label was reachable only from the web
// UI. In a CLI-only product that is a hole, not a convenience gap, so the
// parity test now requires it.
func newLabelEditCmd() *cobra.Command {
	var name, color, description string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/labels/{id}"},
		Short:       "Rename or recolour a label",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid label id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}

			// Only send what the caller actually set — an omitted flag must mean
			// "leave unchanged", not "clear".
			var req client.UpdateLabelRequest
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("color") {
				req.Color = &color
			}
			if cmd.Flags().Changed("description") {
				req.Description = &description
			}
			if req.Name == nil && req.Color == nil && req.Description == nil {
				return fmt.Errorf("nothing to change: pass --name, --color or --description")
			}

			label, err := c.UpdateLabel(ws, id, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Updated label %s (id %d, color %s)\n",
				label.Name, label.ID, label.Color)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New label name")
	cmd.Flags().StringVar(&color, "color", "", "New label color (#rrggbb)")
	cmd.Flags().StringVar(&description, "description", "", "New description")
	return cmd
}

func newLabelDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "delete <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/labels/{id}"},
		Short:       "Delete a label (removes it from everything it is attached to)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
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

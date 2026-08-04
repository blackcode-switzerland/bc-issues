package commands

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newWorkspaceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "workspace",
		Short: "Manage workspaces (your current scope)",
		Long: `Workspaces partition everything: projects, tasks, issues, labels,
members, activity, analytics. Pick the active workspace once with ` + "`bk workspace use`" + `,
and the rest of bk operates within it.`,
	}
	cmd.AddCommand(
		newWorkspaceListCmd(),
		newWorkspaceShowCmd(),
		newWorkspaceCreateCmd(),
		newWorkspaceUseCmd(),
		newWorkspaceEditCmd(),
		newWorkspaceTransferCmd(),
		newWorkspaceDeleteCmd(),
	)
	return cmd
}

// newWorkspaceListCmd lists the workspaces you can use THIS app in.
//
// The default is app-scoped (Phase 4): a workspace where issues is switched off,
// or where you were never granted it, is not a workspace you can write to, and
// offering it would offer a guaranteed 403.
//
// --all is the escape hatch, and it is not optional politeness. Without it, a
// workspace that this app is not enabled in simply vanishes, and "where did my
// workspace go?" would have no answer from inside the app that hid it. --all
// shows every membership plus the apps you can reach in each.
func newWorkspaceListCmd() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces"},
		Short:       "List workspaces you can use this app in (--all for every membership)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			activeID := cfg.ActiveWorkspaceID

			if all {
				workspaces, err := c.ListAllMyWorkspaces()
				if err != nil {
					return err
				}
				return output.Render(format, workspaces, func(w io.Writer) error {
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE\tAPPS")
					for _, ws := range workspaces {
						mark := " "
						if ws.ID == activeID {
							mark = "*"
						}
						apps := "—"
						if len(ws.Apps) > 0 {
							apps = strings.Join(ws.Apps, ",")
						}
						fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\t%s\n",
							mark, ws.ID, ws.Name, ws.Slug, ws.MemberRole, apps)
					}
					if err := tw.Flush(); err != nil {
						return err
					}
					if len(workspaces) == 0 {
						fmt.Fprintln(cmd.ErrOrStderr(), "(no workspaces)")
					} else {
						fmt.Fprintln(cmd.ErrOrStderr(),
							"\nAPPS is what YOU can open there. An empty column means you are a member "+
								"but have no app access — ask an owner, or see `bk app access list`.")
					}
					return nil
				})
			}

			workspaces, err := c.ListMyWorkspaces()
			if err != nil {
				return err
			}

			return output.Render(format, workspaces, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE")
				for _, ws := range workspaces {
					mark := " "
					if ws.ID == activeID {
						mark = "*"
					}
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n",
						mark, ws.ID, ws.Name, ws.Slug, ws.MemberRole)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(workspaces) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no workspaces you can use this app in — try `bk workspace list --all`)")
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&all, "all", false,
		"Show every workspace you are a member of, with the apps you can reach in each")
	return cmd
}

func newWorkspaceShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show [slug|id]",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}"},
		Short:       "Show details of a workspace (defaults to active)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := resolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			detail, err := c.GetWorkspace(ref)
			if err != nil {
				return err
			}

			return output.Render(format, detail, func(w io.Writer) error {
				fmt.Fprintf(w, "Name:    %s\n", detail.Workspace.Name)
				fmt.Fprintf(w, "Slug:    %s\n", detail.Workspace.Slug)
				fmt.Fprintf(w, "Role:    %s\n", detail.Role)
				fmt.Fprintf(w, "Members: %d\n", len(detail.Members))
				return nil
			})
		},
	}
}

func newWorkspaceCreateCmd() *cobra.Command {
	var name string
	var useAfter bool
	cmd := &cobra.Command{
		Use:         "create --name NAME",
		Annotations: map[string]string{"routes": "POST /api/workspaces"},
		Short:       "Create a new workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := c.CreateWorkspace(name)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Created %s (slug: %s)\n", ws.Name, ws.Slug)
			if useAfter {
				if _, err := c.SetActiveWorkspace(ws.ID); err != nil {
					return err
				}
				cfg.ActiveWorkspaceID = ws.ID
				cfg.ActiveWorkspaceSlug = ws.Slug
				if err := config.Save(cfg); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Active workspace set to %s.\n", ws.Slug)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Workspace name")
	cmd.Flags().BoolVar(&useAfter, "use", true, "Set this workspace as active after creation")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newWorkspaceUseCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "use <slug|id>",
		Annotations: map[string]string{"routes": "POST /api/me/active-workspace,GET /api/workspaces"},
		Short:       "Set the active workspace for subsequent commands",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			detail, err := c.GetWorkspace(args[0])
			if err != nil {
				return err
			}
			if _, err := c.SetActiveWorkspace(detail.Workspace.ID); err != nil {
				return err
			}
			cfg.ActiveWorkspaceID = detail.Workspace.ID
			cfg.ActiveWorkspaceSlug = detail.Workspace.Slug
			if err := config.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Active workspace: %s (%s)\n",
				detail.Workspace.Name, detail.Workspace.Slug)
			return nil
		},
	}
}

func newWorkspaceEditCmd() *cobra.Command {
	var name, slug string
	cmd := &cobra.Command{
		Use:         "edit [slug|id]",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}"},
		Short:       "Edit workspace settings (name, slug)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := resolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			req := client.UpdateWorkspaceRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("slug") {
				req.Slug = &slug
			}
			ws, err := c.UpdateWorkspace(ref, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "updated workspace %q (slug: %s)\n",
				ws.Name, ws.Slug)
			// Refresh config if the active workspace was edited
			if cfg.ActiveWorkspaceSlug == ref || fmt.Sprint(cfg.ActiveWorkspaceID) == ref {
				cfg.ActiveWorkspaceSlug = ws.Slug
				_ = config.Save(cfg)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New workspace name")
	cmd.Flags().StringVar(&slug, "slug", "", "New URL slug (lowercase, no spaces)")
	return cmd
}

func newWorkspaceTransferCmd() *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "transfer [slug|id]",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/transfer"},
		Short:       "Transfer workspace ownership to another member (owner only)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if userRef == "" {
				return fmt.Errorf("--to is required (user id, email, or name)")
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := resolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			newOwnerID, err := ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if !Confirm(fmt.Sprintf("Transfer workspace %q to user #%d? You will become a regular member.", ref, newOwnerID), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.TransferOwnership(ref, newOwnerID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "ownership transferred to user #%d\n", newOwnerID)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "to", "", "New owner (id, email, or name)")
	AddYesFlag(cmd, &yes)
	return cmd
}

// newWorkspaceDeleteCmd deletes a workspace and everything inside it.
//
// This is the most destructive call in the CLI, and the usual `--yes` guard is
// not enough on its own: Confirm() auto-approves under BK_NO_PROMPT=1 and on a
// non-TTY, which is exactly how agents run. So the real guard is --confirm: the
// caller must repeat the workspace back, which cannot happen by accident from a
// wrong variable or a mis-scoped loop.
//
// It also takes the target as an explicit argument rather than falling back to
// the active workspace — "delete whatever I happen to be pointed at" is not a
// safe default for an irreversible operation.
func newWorkspaceDeleteCmd() *cobra.Command {
	var confirmRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete <slug|id> --confirm <slug|id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}"},
		Short:       "Permanently delete a workspace and everything in it (owner only)",
		Long: `Permanently delete a workspace: its projects, tasks, issues, labels,
comments, invitations and membership. This is NOT the Trash — there is no
restore, and ` + "`bk undo`" + ` cannot roll it back.

You must be the workspace owner. To transfer it instead, see
` + "`bk workspace transfer`" + `.

--confirm must repeat the same slug/id you passed as the argument. It is
required even with --yes and even under BK_NO_PROMPT=1.

  bk workspace delete scratch-ws --confirm scratch-ws

If the deleted workspace was your active one, the active workspace is cleared —
run ` + "`bk workspace use <slug>`" + ` to pick a new one.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ref := strings.TrimSpace(args[0])
			if ref == "" {
				return fmt.Errorf("a workspace slug or id is required")
			}
			if strings.TrimSpace(confirmRef) != ref {
				return fmt.Errorf(
					"--confirm is required and must match the workspace being deleted: --confirm %s", ref)
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			if !Confirm(fmt.Sprintf(
				"Permanently delete workspace %q and everything in it? This cannot be undone.", ref), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.DeleteWorkspace(ref); err != nil {
				return err
			}
			// Clear the active workspace if we just deleted it, so the next
			// command fails with "no active workspace" instead of 404-ing.
			if cfg.ActiveWorkspaceSlug == ref || fmt.Sprint(cfg.ActiveWorkspaceID) == ref {
				cfg.ActiveWorkspaceSlug = ""
				cfg.ActiveWorkspaceID = 0
				_ = config.Save(cfg)
				fmt.Fprintln(cmd.ErrOrStderr(),
					"note: that was your active workspace — run `bk workspace use <slug>` to pick another")
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted workspace %q\n", ref)
			return nil
		},
	}
	cmd.Flags().StringVar(&confirmRef, "confirm", "",
		"Repeat the workspace slug/id to authorise the delete (required)")
	AddYesFlag(cmd, &yes)
	return cmd
}

// ---------- shared helpers ----------

func newClientAndConfig() (*client.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	return client.New(cfg.Server, cfg.Token, clientWorkspaceSlug(cfg)), cfg, nil
}

// resolveWorkspaceRef returns either the slug/id explicitly given as the
// first argument, or the active workspace slug from config. Errors if there
// is no argument and no active workspace.
func resolveWorkspaceRef(cfg *config.Config, args []string) (string, error) {
	if len(args) > 0 && args[0] != "" {
		return args[0], nil
	}
	if strings.TrimSpace(wsOverride) != "" {
		return wsOverride, nil
	}
	if cfg.ActiveWorkspaceSlug != "" {
		return cfg.ActiveWorkspaceSlug, nil
	}
	if cfg.ActiveWorkspaceID > 0 {
		return fmt.Sprintf("%d", cfg.ActiveWorkspaceID), nil
	}
	return "", fmt.Errorf("no active workspace — set one with `bk workspace use <slug>` or pass it explicitly")
}

func requireActiveWorkspace(cfg *config.Config) (string, error) {
	return resolveWorkspaceRef(cfg, nil)
}

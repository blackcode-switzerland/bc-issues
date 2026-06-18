package commands

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newWorkspaceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "workspace",
		Short: "Manage workspaces (your current scope)",
		Long: `Workspaces partition everything: projects, milestones, issues, labels,
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
	)
	return cmd
}

func newWorkspaceListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List workspaces you are a member of",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			workspaces, err := c.ListMyWorkspaces()
			if err != nil {
				return err
			}
			activeID := cfg.ActiveWorkspaceID

			return output.Render(format, workspaces, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tID\tNAME\tKEY\tSLUG\tROLE")
				for _, ws := range workspaces {
					mark := " "
					if ws.ID == activeID {
						mark = "*"
					}
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\t%s\n",
						mark, ws.ID, ws.Name, ws.Key, ws.Slug, ws.MemberRole)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(workspaces) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no workspaces)")
				}
				return nil
			})
		},
	}
}

func newWorkspaceShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [slug|id]",
		Short: "Show details of a workspace (defaults to active)",
		Args:  cobra.MaximumNArgs(1),
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
				fmt.Fprintf(w, "Key:     %s\n", detail.Workspace.Key)
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
		Use:   "create --name NAME",
		Short: "Create a new workspace",
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
			fmt.Fprintf(cmd.OutOrStdout(), "Created %s (key: %s, slug: %s)\n", ws.Name, ws.Key, ws.Slug)
			if useAfter {
				if _, err := c.SetActiveWorkspace(ws.ID); err != nil {
					return err
				}
				cfg.ActiveWorkspaceID = ws.ID
				cfg.ActiveWorkspaceSlug = ws.Slug
				cfg.ActiveWorkspaceKey = ws.Key
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
		Use:   "use <slug|id>",
		Short: "Set the active workspace for subsequent commands",
		Args:  cobra.ExactArgs(1),
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
			cfg.ActiveWorkspaceKey = detail.Workspace.Key
			if err := config.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Active workspace: %s (%s)\n",
				detail.Workspace.Name, detail.Workspace.Key)
			return nil
		},
	}
}

func newWorkspaceEditCmd() *cobra.Command {
	var name, slug, key string
	cmd := &cobra.Command{
		Use:   "edit [slug|id]",
		Short: "Edit workspace settings (name, slug, key)",
		Args:  cobra.MaximumNArgs(1),
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
			if cmd.Flags().Changed("key") {
				req.Key = &key
			}
			ws, err := c.UpdateWorkspace(ref, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "updated workspace %q (slug: %s, key: %s)\n",
				ws.Name, ws.Slug, ws.Key)
			// Refresh config if the active workspace was edited
			if cfg.ActiveWorkspaceSlug == ref || fmt.Sprint(cfg.ActiveWorkspaceID) == ref {
				cfg.ActiveWorkspaceSlug = ws.Slug
				cfg.ActiveWorkspaceKey = ws.Key
				_ = config.Save(cfg)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New workspace name")
	cmd.Flags().StringVar(&slug, "slug", "", "New URL slug (lowercase, no spaces)")
	cmd.Flags().StringVar(&key, "key", "", "New short key (2-10 uppercase chars)")
	return cmd
}

func newWorkspaceTransferCmd() *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:   "transfer [slug|id]",
		Short: "Transfer workspace ownership to another member (owner only)",
		Args:  cobra.MaximumNArgs(1),
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

// ---------- shared helpers ----------

func newClientAndConfig() (*client.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	return client.New(cfg.Server, cfg.Token, cfg.ActiveWorkspaceSlug), cfg, nil
}

// resolveWorkspaceRef returns either the slug/id explicitly given as the
// first argument, or the active workspace slug from config. Errors if there
// is no argument and no active workspace.
func resolveWorkspaceRef(cfg *config.Config, args []string) (string, error) {
	if len(args) > 0 && args[0] != "" {
		return args[0], nil
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

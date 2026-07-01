package commands

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk meta` mirrors GET /api/meta — the single bootstrap call an agent should
// make first. It answers "who am I, which workspaces can I write to, and which
// one is active", so an agent can pick its target BY NAME/SLUG instead of an
// opaque numeric id (the most common cause of writing to the wrong workspace).
func newMetaCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "meta",
		Short: "Bootstrap context: who am I + every workspace I can write to",
		Long: `Print the agent bootstrap context (GET /api/meta): the authenticated
user, the active workspace, and EVERY workspace you belong to.

Pick the workspace you write to by its NAME/SLUG from the list below — not by the
numeric id (ids are opaque and easy to confuse). Then target it with
` + "`bk workspace use <slug>`" + ` or a per-command ` + "`--ws <slug>`" + `. The active
workspace is only a default, not necessarily where you mean to write.

Use --ws <slug|id> to preview another workspace's context without switching.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := newClientAndConfig()
			if err != nil {
				return err
			}
			meta, err := c.Meta(clientWorkspaceSlug(cfg))
			if err != nil {
				return err
			}

			return output.Render(format, meta, func(w io.Writer) error {
				name := ""
				if meta.User.Name != nil {
					name = *meta.User.Name
				}
				fmt.Fprintf(w, "user:   %s <%s> (id %d, via %s)\n", name, meta.User.Email, meta.User.ID, meta.User.Via)
				if meta.ActiveWorkspace != nil {
					fmt.Fprintf(w, "active: %s (slug %s, id %d, role %s)\n",
						meta.ActiveWorkspace.Name, meta.ActiveWorkspace.Slug, meta.ActiveWorkspace.ID, meta.ActiveWorkspace.Role)
				} else {
					fmt.Fprintln(w, "active: (none — run `bk workspace use <slug>`)")
				}
				fmt.Fprintln(w)

				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE")
				for _, ws := range meta.Workspaces {
					mark := " "
					if ws.IsActive {
						mark = "*"
					}
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n", mark, ws.ID, ws.Name, ws.Slug, ws.Role)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(meta.Workspaces) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no workspaces)")
				} else {
					fmt.Fprintln(cmd.ErrOrStderr(), "\nPick your target by SLUG (e.g. `bk workspace use <slug>` or `--ws <slug>`), not the id.")
				}
				return nil
			})
		},
	}
}

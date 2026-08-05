package platform

// `bk link` — typed relations between any two entities, in any two apps.
//
// A BARE platform verb, not `bk issues link`, and that placement is the whole
// point of the command. A link's two ends may live in different apps; a command
// nested under one app would have to claim one of them owns the relation, and
// neither does. It reads `platform.links`, which every app writes to, so it works
// unchanged the day a second app appears — nothing here knows what an "issue" is.
//
// Links are DIRECTED and stored once. `A blocks B` is one row; `bk link list B`
// reports it as an incoming `blocks` from A. There is no inverse row, because two
// rows for one fact is two things that can disagree.

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

const linkLong = `Relate two entities by URN, across apps.

A URN addresses anything in any app:

  bc:<app>:<workspace-slug>/<entity-type>/<number>
  bc:issues:kali-sa/issue/482

The number is the workspace #number — the #N shown in the app — never an
internal id. Find one with "bk search <query>".

Relations are directed: "A blocks B" is stored once and shows up as an outgoing
link on A and an incoming link on B. Run "bk meta" for the relation names this
server accepts (they are served under links.relations, not baked into this
binary).`

func newLinkCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "link",
		Short: "Relate two entities by URN (across apps)",
		Long:  linkLong,
	}
	cmd.AddCommand(newLinkCreateCmd(), newLinkListCmd(), newLinkRemoveCmd())
	return cmd
}

func newLinkCreateCmd() *cobra.Command {
	var rel string
	cmd := &cobra.Command{
		Use:         "create <from-urn> <to-urn> --rel <relation>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/links"},
		Short:       "Link one entity to another",
		Long: `Link one entity to another.

Idempotent — creating the same link twice succeeds and reports created=false,
so a retry after a timeout is not a failure.

  bk link create bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if rel == "" {
				return fmt.Errorf("--rel is required (run `bk meta` for the accepted relations)")
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			res, err := c.CreateLink(args[0], args[1], rel)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				if res.Created {
					fmt.Fprintf(w, "linked %s --%s--> %s\n", res.From, res.Rel, res.To)
				} else {
					fmt.Fprintf(w, "already linked: %s --%s--> %s\n", res.From, res.Rel, res.To)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&rel, "rel", "", "Relation type (run `bk meta` for the list)")
	return cmd
}

func newLinkListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list <urn>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/links"},
		Short:       "Show every link touching an entity, in both directions",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			links, err := c.ListLinks(args[0])
			if err != nil {
				return err
			}
			return output.Render(format, links, func(w io.Writer) error {
				if len(links) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no links)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "DIR\tREL\tOTHER\tTITLE")
				for _, l := range links {
					dir := "→"
					if l.Direction == "in" {
						dir = "←"
					}
					title := l.OtherTitle
					// A link into the recycle bin is kept and flagged rather than
					// hidden: "blocks something that was binned" is exactly the
					// state a caller needs to be told about.
					if l.OtherDeleted {
						title += " (in trash)"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", dir, l.Rel, l.OtherURN, title)
				}
				return tw.Flush()
			})
		},
	}
}

func newLinkRemoveCmd() *cobra.Command {
	var rel string
	cmd := &cobra.Command{
		Use:         "rm <from-urn> <to-urn> --rel <relation>",
		Aliases:     []string{"remove", "delete"},
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/links"},
		Short:       "Remove a link",
		Long: `Remove a link.

All three parts identify it, direction included: removing "A blocks B" is not
the same request as removing "B blocks A". Check the direction first with
"bk link list <urn>".`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if rel == "" {
				return fmt.Errorf("--rel is required — a link is identified by from, to AND rel")
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if err := c.DeleteLink(args[0], args[1], rel); err != nil {
				return err
			}
			return output.Render(format, map[string]any{"deleted": true}, func(w io.Writer) error {
				fmt.Fprintf(w, "removed %s --%s--> %s\n", args[0], rel, args[1])
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&rel, "rel", "", "Relation type of the link to remove")
	return cmd
}

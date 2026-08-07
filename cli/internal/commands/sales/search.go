package sales

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales search` — the INSIDE-the-records half of D-9.
//
// ---------------------------------------------------------------------------
// THIS IS NOT `bk search`, AND THE DIFFERENCE IS THE POINT
// ---------------------------------------------------------------------------
//
//	bk search        cross-app, bare. Reads the platform entity index, which
//	                 holds TITLES ONLY. "Where is the thing called X, in ANY
//	                 app?" Returns URNs, tagged with the app they came from.
//
//	bk sales search  app-owned. Reads this app's full-text columns. "Find X
//	                 INSIDE prospect summaries, meeting outcomes, communication
//	                 bodies, template copy." Returns records, with the matching
//	                 text.
//
// Reaching for the wrong one is the most likely mistake an agent makes here, so
// the snippet column exists partly to make the difference visible: a hit with a
// snippet came from a column the cross-app index does not have.
func newSearchCmd() *cobra.Command {
	var types []string
	var limit int
	cmd := &cobra.Command{
		Use:         "search <query>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sales-search"},
		Short:       "Full-text search INSIDE this app's records",
		Long: `Search the text inside this app's records — summaries, outcomes, message
bodies, objections, product pitches, template copy.

For "where is the thing called X" across every app, use "bk search" instead: it
reads the shared entity index and returns URNs. This one reads this app's own
columns and returns what matched.

--type narrows it; run "bk meta" for the searchable types. Note they are WIDER
than the addressable ones: a contact and an objection are searchable and have no
#number, so those hits carry their prospect instead.`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			hits, err := c.SalesSearch(ws, strings.Join(args, " "), splitAll(types), limit)
			if err != nil {
				return err
			}
			return output.Render(format, hits, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "TYPE\tREF\tTITLE\tMATCH")
				for _, h := range hits {
					ref := "—"
					if h.Number != nil {
						ref = fmt.Sprintf("%d", *h.Number)
					} else if h.ProspectNumber != nil {
						// No #number of its own: say which prospect it hangs off,
						// which is the only address a caller can act on.
						ref = fmt.Sprintf("via prospect %d", *h.ProspectNumber)
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						h.Type, ref, cmdutil.Truncate(h.Title, 30),
						cmdutil.Truncate(strings.ReplaceAll(h.Snippet, "\n", " "), 56))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(hits) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no matches inside this app's records — `bk search` looks across apps by title)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringSliceVar(&types, "type", nil, "Restrict to these record types (`bk meta` for the list)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max hits (`bk meta` for the cap)")
	return cmd
}

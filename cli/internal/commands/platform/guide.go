package platform

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/guide"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
	"github.com/spf13/cobra"
)

// `bk guide` is the read-me-first command for agents: the complete usage guide
// for the running binary, embedded via //go:embed.
//
// Hard requirement: it works OFFLINE and UNAUTHENTICATED. No HTTP, no config, no
// token. This is precisely what an agent runs when everything else is failing —
// if it needed the network it would be useless at the moment it matters most.
func newGuideCmd() *cobra.Command {
	var list bool
	var app string

	cmd := &cobra.Command{
		Use:   "guide [topic]",
		Short: "The complete usage guide for this bk binary (offline, no auth)",
		Long: `Print the agent guide embedded in this binary.

  bk guide                     the whole guide — platform first, then each app
  bk guide --list              one line per topic
  bk guide <topic>             a single topic, e.g. platform/workspaces
  bk guide --app issues        only that app's topics
  bk guide --app platform      only the topics true in every app
  bk guide --json              { version, topics: [{ slug, section, title, … }] }

Topics are section-qualified: ` + "`platform/…`" + ` for what holds everywhere,
` + "`<app>/…`" + ` for one app's behaviour. A bare slug (` + "`bk guide files`" + `) still
resolves while it is unambiguous.

Works offline and unauthenticated: it describes THIS binary, so it can never
tell you about a flag you do not have. Values that change without a CLI release
— status/priority vocabularies, size limits, the upload block list — are not
repeated here. Run ` + "`bk meta`" + ` for those.`,
		Args: cobra.MaximumNArgs(1),
		// Offline command: no HTTP routes. The parity test requires every leaf
		// command to declare its routes, and "none" is the explicit way to say
		// "this one calls nothing" — silence would look like an oversight.
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}

			// --app scopes everything below it to one section.
			if app != "" {
				if !knownSection(app) {
					return fmt.Errorf(
						"invalid --app %q\nvalid sections: %s",
						app, strings.Join(guide.Sections(), ", "))
				}
			}

			topics := guide.Topics()
			if app != "" {
				topics = guide.TopicsIn(app)
			}

			// --list: slug + one-line summary.
			if list {
				return output.Render(format, map[string]any{
					"version": version.Version,
					"topics":  topics,
				}, func(w io.Writer) error {
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "TOPIC\tSUMMARY")
					for _, t := range topics {
						fmt.Fprintf(tw, "%s\t%s\n", t.Slug, t.Summary)
					}
					if err := tw.Flush(); err != nil {
						return err
					}
					fmt.Fprintln(cmd.ErrOrStderr(), "\nRead one: `bk guide <topic>`. Read all: `bk guide`.")
					return nil
				})
			}

			// A single topic.
			if len(args) == 1 {
				t, ok := guide.Lookup(args[0])
				if !ok {
					// Naming BOTH candidates beats refusing: an agent that typed a
					// bare slug two apps now share can fix it in the same run.
					if amb := guide.Ambiguous(args[0]); len(amb) > 0 {
						return fmt.Errorf(
							"ambiguous guide topic %q — it exists in more than one section: %s",
							args[0], strings.Join(amb, ", "))
					}
					// "invalid …" classifies as exit 2 (usage) in main.go. Listing
					// the valid slugs makes it recoverable in the same run.
					return fmt.Errorf(
						"invalid guide topic %q\nvalid topics: %s",
						args[0], strings.Join(guide.Slugs(), ", "))
				}
				return output.Render(format, t, func(w io.Writer) error {
					_, err := fmt.Fprint(w, guide.RenderTopic(t))
					return err
				})
			}

			// The whole guide, or one section of it.
			return output.Render(format, map[string]any{
				"version": version.Version,
				"topics":  topics,
			}, func(w io.Writer) error {
				if app != "" {
					_, err := fmt.Fprint(w, guide.RenderSection(version.Version, app))
					return err
				}
				_, err := fmt.Fprint(w, guide.Render(version.Version))
				return err
			})
		},
	}

	cmd.Flags().BoolVar(&list, "list", false, "List topic slugs with a one-line summary")
	cmd.Flags().StringVar(&app, "app", "",
		"Scope to one section: an app slug, or \"platform\" for the topics true in every app")
	return cmd
}

func knownSection(s string) bool {
	for _, sec := range guide.Sections() {
		if sec == s {
			return true
		}
	}
	return false
}

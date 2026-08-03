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

// defaultChangelogServer is used when the user runs `bk changelog` before ever
// logging in. The changelog is public, and the whole point of the command is to
// help an out-of-date setup get current — so it must work without a config file.
const defaultChangelogServer = "https://bc-issues.vercel.app"

// `bk changelog` mirrors GET /api/changelog: the dated record of what changed.
//
// It no longer has a --reference flag. That printed a server-hosted "Platform
// Reference" — a complete snapshot of the surface — which is precisely the kind
// of copy that drifts (its CLI version was stale before we retired it). The
// current surface is `bk guide`, embedded in THIS binary, so it can never
// describe a version you are not running. The flag is kept as a hidden alias
// that redirects, rather than vanishing into "unknown flag".
func newChangelogCmd() *cobra.Command {
	var full, reference bool
	var serverFlag string

	cmd := &cobra.Command{
		Use:         "changelog",
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		Short:       "What's changed in the API and CLI (read this to get up to date)",
		Long: `Print the product changelog (GET /api/changelog).

Default: a table of dated changes, newest first.
  --full        print every dated entry in full

For how the CLI WORKS (rather than what changed), run ` + "`bk guide`" + ` — the
complete usage guide embedded in this binary.

The changelog is public, so this works even before ` + "`bk login`" + `. If a
command that used to work now fails, run ` + "`bk skill sync`" + `, then check here.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}

			// --reference was retired with the Platform Reference it printed.
			// Redirect instead of failing: a hint an agent can act on beats an
			// "unknown flag" it can only give up on.
			if reference {
				fmt.Fprintln(cmd.ErrOrStderr(),
					"hint: --reference was retired — the platform reference is now the embedded guide.\n"+
						"      Run `bk guide` (offline, always matches this binary).")
			}

			c := changelogClient(serverFlag)
			cl, err := c.Changelog()
			if err != nil {
				return err
			}

			return output.Render(format, cl, func(w io.Writer) error {
				if full {
					// Whole dated log, in full.
					for i, e := range cl.Entries {
						if i > 0 {
							fmt.Fprintln(w)
						}
						fmt.Fprintf(w, "## %s — %s\n\n", e.Date, e.Title)
						fmt.Fprintln(w, strings.TrimSpace(e.Markdown))
					}
					return nil
				}

				// Default: a compact table of dated entries.
				fmt.Fprintf(w, "blackcode issues — changelog (CLI latest v%s, min v%s)\n\n",
					cl.CLILatestVersion, cl.CLIMinVersion)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "DATE\tCHANGE")
				for _, e := range cl.Entries {
					date := e.Date
					if date == "" {
						date = "—"
					}
					fmt.Fprintf(tw, "%s\t%s\n", date, e.Title)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintln(cmd.ErrOrStderr(),
					"\nRead every entry in full: `bk changelog --full`. How the CLI works: `bk guide`.")
				return nil
			})
		},
	}

	cmd.Flags().BoolVar(&full, "full", false, "Print every dated entry in full")
	cmd.Flags().BoolVar(&reference, "reference", false, "Retired — the platform reference is now `bk guide`")
	_ = cmd.Flags().MarkDeprecated("reference", "the platform reference is now the embedded guide: run `bk guide`")
	cmd.Flags().StringVar(&serverFlag, "server", "", "Server base URL (default: your logged-in server, else "+defaultChangelogServer+")")
	return cmd
}

// changelogClient builds a client for the public changelog endpoint. It prefers
// an explicit --server, then the logged-in server from config, then the default
// host — so the command works with no config at all.
func changelogClient(serverFlag string) *client.Client {
	server := strings.TrimSpace(serverFlag)
	token := ""
	if server == "" {
		if cfg, err := config.Load(); err == nil {
			server = cfg.Server
			token = cfg.Token
		}
	}
	if server == "" {
		server = defaultChangelogServer
	}
	return client.New(server, token, "")
}

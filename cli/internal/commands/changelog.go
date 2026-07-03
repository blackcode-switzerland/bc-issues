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

// `bk changelog` mirrors GET /api/changelog. By default it prints the dated
// change log (newest first); --reference prints the pinned Platform Reference
// baseline; --full prints both. Read this to bring an outdated skill current.
func newChangelogCmd() *cobra.Command {
	var full, reference bool
	var serverFlag string

	cmd := &cobra.Command{
		Use:   "changelog",
		Short: "What's changed in the API and CLI (read this to get up to date)",
		Long: `Print the product changelog (GET /api/changelog).

Default: the dated log of changes, newest first.
  --reference   print the pinned Platform Reference baseline (the complete
                current API + CLI surface, data types, rules and warnings)
  --full        print the reference followed by every dated entry

The changelog is public, so this works even before ` + "`bk login`" + `. If a
request that used to work now fails, check here first, then
` + "`npm install -g @blackcode_sa/bc-issues@latest`" + ` to update the CLI.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}

			c := changelogClient(serverFlag)
			cl, err := c.Changelog()
			if err != nil {
				return err
			}

			return output.Render(format, cl, func(w io.Writer) error {
				if reference || full {
					fmt.Fprintln(w, strings.TrimSpace(cl.Reference.Markdown))
					if full {
						fmt.Fprintln(w)
						fmt.Fprintln(w, strings.Repeat("─", 60))
						fmt.Fprintln(w)
					}
				}
				if reference && !full {
					return nil
				}

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
					"\nRead a full entry: `bk changelog --full`. Complete surface: `bk changelog --reference` (or /changelog).")
				return nil
			})
		},
	}

	cmd.Flags().BoolVar(&full, "full", false, "Print the reference and every dated entry in full")
	cmd.Flags().BoolVar(&reference, "reference", false, "Print only the pinned Platform Reference baseline")
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

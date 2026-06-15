package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

const superAdminLong = `Platform-wide administration. These commands require a
super-admin token (an account whose email is listed in the server's
SUPER_ADMINS env var); any other token gets a permission error (exit 4).

Everything here affects the WHOLE platform, across every workspace:

  users       list every member on the platform
  whitelist   manage which emails/domains may register or be invited
  errors      browse, triage, and clear the server error log`

func newSuperAdminCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "super-admin",
		Aliases: []string{"admin"},
		Short:   "Platform-wide administration (super admins only)",
		Long:    superAdminLong,
	}
	cmd.AddCommand(
		newSuperAdminUsersCmd(),
		newSuperAdminWhitelistCmd(),
		newSuperAdminErrorsCmd(),
	)
	return cmd
}

// ---------- users ----------

func newSuperAdminUsersCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "users",
		Short: "List every member across the whole platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			users, err := c.ListPlatformUsers()
			if err != nil {
				return err
			}
			return output.Render(format, users, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tEMAIL\tNAME\tWORKSPACES\tLAST LOGIN\tJOINED")
				for _, u := range users {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%d\t%s\t%s\n",
						u.ID, u.Email, derefOr(u.Name, "—"), u.WorkspaceCount,
						derefOr(u.LastLogin, "—"), derefOr(u.CreatedAt, "—"))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(users) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no users)")
				}
				return nil
			})
		},
	}
}

// ---------- whitelist ----------

func newSuperAdminWhitelistCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "whitelist",
		Aliases: []string{"wl"},
		Short:   "Manage the platform access whitelist (domains + emails)",
	}
	cmd.AddCommand(
		newWhitelistListCmd(),
		newWhitelistAddCmd(),
		newWhitelistRemoveCmd(),
	)
	return cmd
}

func newWhitelistListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List allowed domains and emails",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			entries, err := c.ListWhitelist()
			if err != nil {
				return err
			}
			return output.Render(format, entries, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tTYPE\tVALUE\tADDED")
				for _, e := range entries {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n", e.ID, e.Type, e.Value, e.CreatedAt)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(entries) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(whitelist empty — add a domain with `bk super-admin whitelist add --type domain --value blackcode.ch`)")
				}
				return nil
			})
		},
	}
}

func newWhitelistAddCmd() *cobra.Command {
	var typ, value string
	cmd := &cobra.Command{
		Use:   "add --type domain|email --value <value>",
		Short: "Allow a domain or email to register / be invited platform-wide",
		Example: `  bk super-admin whitelist add --type domain --value blackcode.ch
  bk super-admin whitelist add --type email --value contractor@example.com`,
		RunE: func(cmd *cobra.Command, args []string) error {
			typ = strings.ToLower(strings.TrimSpace(typ))
			value = strings.TrimSpace(value)
			if typ != "domain" && typ != "email" {
				return fmt.Errorf("--type must be 'domain' or 'email'")
			}
			if value == "" {
				return fmt.Errorf("--value is required")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			entry, msg, err := c.AddWhitelistEntry(typ, value)
			if err != nil {
				return err
			}
			if entry == nil {
				// Value already present (server returned a message, not an entry).
				if msg == "" {
					msg = "already in whitelist"
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s: %s\n", value, msg)
				return nil
			}
			fmt.Fprintf(cmd.OutOrStdout(), "added %s %q to the whitelist (id %d)\n", entry.Type, entry.Value, entry.ID)
			return nil
		},
	}
	cmd.Flags().StringVar(&typ, "type", "", "Entry type: domain | email")
	cmd.Flags().StringVar(&value, "value", "", "The domain (e.g. blackcode.ch) or email address")
	_ = cmd.MarkFlagRequired("type")
	_ = cmd.MarkFlagRequired("value")
	return cmd
}

func newWhitelistRemoveCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:     "remove <id>",
		Aliases: []string{"rm", "delete"},
		Short:   "Remove a whitelist entry by id",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			if !Confirm(fmt.Sprintf("Remove whitelist entry %d? New signups matching it will be blocked.", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.RemoveWhitelistEntry(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed whitelist entry %d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

// ---------- errors ----------

func newSuperAdminErrorsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "errors",
		Aliases: []string{"error", "logs"},
		Short:   "Browse and triage the platform error log",
	}
	cmd.AddCommand(
		newErrorsListCmd(),
		newErrorsViewCmd(),
		newErrorsResolveCmd(true),
		newErrorsResolveCmd(false),
		newErrorsDeleteCmd(),
		newErrorsStatsCmd(),
	)
	return cmd
}

func newErrorsListCmd() *cobra.Command {
	var (
		level, status, from, to string
		limit, cursor           int
		stats                   bool
	)
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List error events (newest first)",
		Long: `List platform error events, newest first.

Filter by --level, triage --status (open|resolved), or an occurred-at window
(--from/--to). Paginate with --limit/--cursor; in table mode the next cursor is
printed to stderr. --stats also prints aggregate counts.`,
		Example: `  bk super-admin errors list --status open --limit 20
  bk super-admin errors list --level error --from 2026-06-01
  bk super-admin errors list --stats`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			opts := client.AdminErrorsOpts{
				Level:  level,
				Status: strings.ToLower(strings.TrimSpace(status)),
				From:   from,
				To:     to,
				Limit:  limit,
				Stats:  stats,
			}
			if cursor > 0 {
				opts.Cursor = &cursor
			}
			page, err := c.ListAdminErrors(opts)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tLEVEL\tSTATUS\tCODE\tROUTE\tMESSAGE\tWHEN")
				for _, e := range page.Data {
					triage := "open"
					if e.Resolved {
						triage = "resolved"
					}
					route := derefOr(e.Route, "—")
					if e.Method != nil && *e.Method != "" {
						route = *e.Method + " " + route
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						e.ID, e.Level, triage, derefOr(e.Code, "—"),
						truncate(route, 32), truncate(e.Message, 60), e.OccurredAt)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no errors)")
				}
				if page.Stats != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "stats: %d total · %d open · %d resolved\n",
						page.Stats.Total, page.Stats.Unresolved, page.Stats.Resolved)
				}
				if page.NextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "next page: --cursor=%d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&level, "level", "", "Filter by level (e.g. error, warn)")
	cmd.Flags().StringVar(&status, "status", "", "Filter by triage state: open | resolved")
	cmd.Flags().StringVar(&from, "from", "", "Only events at/after this time (YYYY-MM-DD or ISO)")
	cmd.Flags().StringVar(&to, "to", "", "Only events at/before this time (YYYY-MM-DD or ISO)")
	cmd.Flags().IntVar(&limit, "limit", 50, "Max events to return (1-200)")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Pagination cursor (id from a previous page)")
	cmd.Flags().BoolVar(&stats, "stats", false, "Also print aggregate counts")
	return cmd
}

func newErrorsViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view <id>",
		Short: "Show full detail for one error (stack + context)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			ev, err := c.GetAdminError(id)
			if err != nil {
				return err
			}
			return output.Render(format, ev, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "ID\t%d\n", ev.ID)
				fmt.Fprintf(tw, "Level\t%s\n", ev.Level)
				triage := "open"
				if ev.Resolved {
					triage = "resolved"
					if ev.ResolvedAt != nil {
						triage += " (" + *ev.ResolvedAt + ")"
					}
				}
				fmt.Fprintf(tw, "Status\t%s\n", triage)
				fmt.Fprintf(tw, "Code\t%s\n", derefOr(ev.Code, "—"))
				if ev.StatusCode != nil {
					fmt.Fprintf(tw, "HTTP\t%d\n", *ev.StatusCode)
				}
				route := derefOr(ev.Route, "—")
				if ev.Method != nil && *ev.Method != "" {
					route = *ev.Method + " " + route
				}
				fmt.Fprintf(tw, "Route\t%s\n", route)
				fmt.Fprintf(tw, "When\t%s\n", ev.OccurredAt)
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintf(w, "\nMessage:\n%s\n", ev.Message)
				if ev.Stack != nil && *ev.Stack != "" {
					fmt.Fprintf(w, "\nStack:\n%s\n", *ev.Stack)
				}
				if len(ev.Context) > 0 && string(ev.Context) != "null" {
					var pretty any
					if json.Unmarshal(ev.Context, &pretty) == nil {
						if b, err := json.MarshalIndent(pretty, "", "  "); err == nil {
							fmt.Fprintf(w, "\nContext:\n%s\n", b)
						}
					}
				}
				return nil
			})
		},
	}
}

// newErrorsResolveCmd builds either the `resolve` or `unresolve` command.
func newErrorsResolveCmd(resolve bool) *cobra.Command {
	use := "resolve <id>"
	short := "Mark an error as resolved"
	if !resolve {
		use = "unresolve <id>"
		short = "Re-open a resolved error"
	}
	return &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			ev, err := c.SetErrorResolved(id, resolve)
			if err != nil {
				return err
			}
			state := "resolved"
			if !ev.Resolved {
				state = "re-opened"
			}
			fmt.Fprintf(cmd.OutOrStdout(), "error %d %s\n", ev.ID, state)
			return nil
		},
	}
}

func newErrorsDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:     "delete <id> [<id> ...]",
		Aliases: []string{"rm"},
		Short:   "Permanently delete one or more error events",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ids := make([]int, 0, len(args))
			for _, a := range args {
				id, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, id)
			}
			noun := "error"
			if len(ids) > 1 {
				noun = fmt.Sprintf("%d errors", len(ids))
			}
			if !Confirm(fmt.Sprintf("Permanently delete %s? This cannot be undone.", noun), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if len(ids) == 1 {
				if err := c.DeleteAdminError(ids[0]); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "deleted error %d\n", ids[0])
				return nil
			}
			deleted, err := c.DeleteAdminErrors(ids)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted %d errors\n", deleted)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

func newErrorsStatsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stats",
		Short: "Show aggregate error counts (total / open / resolved)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			// Pull stats only; limit=1 keeps the payload small.
			page, err := c.ListAdminErrors(client.AdminErrorsOpts{Limit: 1, Stats: true})
			if err != nil {
				return err
			}
			stats := page.Stats
			if stats == nil {
				stats = &client.ErrorEventStats{}
			}
			return output.Render(format, stats, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "Total\t%d\n", stats.Total)
				fmt.Fprintf(tw, "Open\t%d\n", stats.Unresolved)
				fmt.Fprintf(tw, "Resolved\t%d\n", stats.Resolved)
				return tw.Flush()
			})
		},
	}
}

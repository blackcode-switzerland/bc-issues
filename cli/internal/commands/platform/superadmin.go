package platform

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

const superAdminLong = `Platform-wide administration. These commands require a
super-admin token (an account whose email is listed in the server's
SUPER_ADMINS env var); any other token gets a permission error (exit 4).

Everything here affects the WHOLE platform, across every workspace:

  users         list every member on the platform
  whitelist     manage which emails/domains may register or be invited
  errors        browse, triage, and clear the server error log
  entity-drift  check the entity index against THIS server's app's tables
  blob-drift    check the cross-app blob-reference index against a live scan`

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
		newSuperAdminEntityDriftCmd(),
		newSuperAdminBlobDriftCmd(),
	)
	return cmd
}

// ---------- blob-drift (the Phase 8 storage reconciliation job) ----------

func newSuperAdminBlobDriftCmd() *cobra.Command {
	var (
		repair bool
		ws     string
	)
	cmd := &cobra.Command{
		Use: "blob-drift",
		Annotations: map[string]string{
			"routes": "GET /api/super-admin/blob-drift, POST /api/super-admin/blob-drift",
		},
		Short: "Check platform.blob_references against a live scan of this app's tables",
		Long: `Check the cross-app blob-reference index against a live scan.

platform.blob_references is how one deployment learns what ANOTHER app's content
points at, without being able to read its tables. It is maintained by Postgres
triggers, so no application write path can forget it — this command is what
proves that is still true.

  missing   a live reference the index does not have. THE SERIOUS ONE: another
            deployment would read the index, find nothing, and delete a file
            that is still in use. Vercel Blob del() has no undo.
  orphaned  an index entry nothing references any more. Costs a refused delete
            (leaked bytes), never data.

Exit is 0 whether or not there is drift; read missing_count first. --repair
re-triggers the affected source rows and purges true orphans, but read a repair
that changes something as a BUG REPORT: a trigger did not fire, and that is a
fault in the schema. --workspace narrows it to one workspace.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if ws == "" {
				ws = cmdutil.WSOverride
			}
			rep, err := c.BlobDrift(ws, repair)
			if err != nil {
				return err
			}
			return output.Render(format, rep, func(w io.Writer) error {
				fmt.Fprintf(w, "Scope:   %s\n", rep.Scope)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "APP\tSCANNED\tINDEXED")
				for app, n := range rep.ScannedCounts {
					fmt.Fprintf(tw, "%s\t%d\t%d\n", app, n, rep.IndexedCounts[app])
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				// Printed BEFORE the verdict, and on stdout, because it qualifies
				// the verdict: "no drift" over an index a fifth of which was never
				// examined is not the same statement as "no drift".
				if rep.UnreconciledCount > 0 {
					fmt.Fprintf(w, "\nUnreconciled: %d index row(s) no workspace pass could reach\n",
						rep.UnreconciledCount)
					fmt.Fprintln(w, "  (workspace_id null, or a workspace that no longer exists — these were NOT checked)")
				}
				if rep.DriftCount == 0 {
					fmt.Fprintln(w, "\nNo drift.")
					return nil
				}
				fmt.Fprintf(w, "\nDrift: %d missing, %d orphaned\n", rep.MissingCount, rep.OrphanedCount)
				dt := output.Tabwriter(w)
				fmt.Fprintln(dt, "KIND\tAPP\tSOURCE\tURL")
				for _, d := range rep.Drift {
					fmt.Fprintf(dt, "%s\t%s\t%s:%d\t%s\n", d.Kind, d.App, d.SourceType, d.SourceID,
						cmdutil.Truncate(d.URL, 60))
				}
				if err := dt.Flush(); err != nil {
					return err
				}
				// Never let a cap read as a clean bill of health.
				if rep.DriftTruncated > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(), "(%d more not listed)\n", rep.DriftTruncated)
				}
				// A missing row is the one that ends in a deleted file. Say so on
				// stderr, where a script that only parses stdout still shows it.
				if rep.MissingCount > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(),
						"warning: %d live reference(s) are absent from the index — a deployment that cannot scan this app would consider those files unreferenced\n",
						rep.MissingCount)
				}
				if repair {
					fmt.Fprintf(w, "Repaired: %d\n", rep.Repaired)
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&repair, "repair", false, "Fix the drift as well as reporting it")
	cmd.Flags().StringVar(&ws, "workspace", "", "Only this workspace (slug); default is every workspace")
	return cmd
}

// ---------- entity-drift (the Phase 6 reconciliation job) ----------

func newSuperAdminEntityDriftCmd() *cobra.Command {
	var (
		repair bool
		ws     string
	)
	cmd := &cobra.Command{
		Use: "entity-drift",
		// Both verbs on one command: GET reports, POST repairs. Annotated with
		// both so cli-parity sees the POST route is reachable.
		Annotations: map[string]string{
			"routes": "GET /api/super-admin/entity-drift, POST /api/super-admin/entity-drift",
		},
		Short: "Check platform.entities against THIS SERVER's app's source tables",
		Long: `Check the cross-app entity index against the source tables of the app you
are talking to.

platform.entities is a PROJECTION: the apps' own tables are the truth, and every
write is supposed to update both in one transaction. This re-derives the
projection and reports the difference.

  missing   a source row with no entry — a write path did not project
  stale     title, url or trashed state disagree
  orphaned  an entry with no source row

ONE APP AT A TIME, AND NOT BY CHOICE. The index is shared, but each deployment
can only re-derive its OWN half: an app's Postgres role has no grant on another
app's schema, so the comparison cannot be written at all. Whichever server you
are pointed at answers for ITS app and reports nothing about the others — a
clean report here is not a clean report for the platform. Run it against each
app's server in turn (bk app list shows them), and mind that an app which has
not mounted this route answers 404 rather than "no drift".

This text used to say "each app's source tables". It was read that way, and the
answer it gave against a database with fifty-one unprojected rows in another
app was "no drift", exit 0.

Exit is 0 whether or not there is drift; read drift_count. --repair fixes all
three, but read a repair that changes something as a BUG REPORT, not as
maintenance: there is one writer per app, so anything it fixes means that
writer is wrong. --ws narrows it to one workspace.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if ws == "" {
				ws = cmdutil.WSOverride
			}
			rep, err := c.EntityDrift(ws, repair)
			if err != nil {
				return err
			}
			return output.Render(format, rep, func(w io.Writer) error {
				fmt.Fprintf(w, "Scope:   %s\n", rep.Scope)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "TYPE\tSOURCE\tPROJECTED")
				for t, n := range rep.SourceCounts {
					fmt.Fprintf(tw, "%s\t%d\t%d\n", t, n, rep.ProjectedCounts[t])
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if rep.DriftCount == 0 {
					fmt.Fprintln(w, "\nNo drift.")
					return nil
				}
				fmt.Fprintf(w, "\nDrift: %d row(s)\n", rep.DriftCount)
				dt := output.Tabwriter(w)
				fmt.Fprintln(dt, "KIND\tURN\tDETAIL")
				for _, d := range rep.Drift {
					fmt.Fprintf(dt, "%s\t%s\t%s\n", d.Kind, d.URN, d.Detail)
				}
				if err := dt.Flush(); err != nil {
					return err
				}
				// Never let a cap read as a clean bill of health.
				if rep.DriftTruncated > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(), "(%d more not listed)\n", rep.DriftTruncated)
				}
				if repair {
					fmt.Fprintf(w, "Repaired: %d\n", rep.Repaired)
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&repair, "repair", false, "Fix the drift as well as reporting it")
	cmd.Flags().StringVar(&ws, "workspace", "", "Only this workspace (slug); default is every workspace")
	return cmd
}

// ---------- users ----------

func newSuperAdminUsersCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "users",
		Annotations: map[string]string{"routes": "GET /api/super-admin/users"},
		Short:       "List every member across the whole platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
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
						u.ID, u.Email, cmdutil.DerefOr(u.Name, "—"), u.WorkspaceCount,
						cmdutil.DerefOr(u.LastLogin, "—"), cmdutil.DerefOr(u.CreatedAt, "—"))
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
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/super-admin/whitelist"},
		Short:       "List allowed domains and emails",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
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
		Use:         "add --type domain|email --value <value>",
		Annotations: map[string]string{"routes": "POST /api/super-admin/whitelist"},
		Short:       "Allow a domain or email to register / be invited platform-wide",
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
			c, err := cmdutil.NewClient()
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
		Use:         "remove <id>",
		Annotations: map[string]string{"routes": "DELETE /api/super-admin/whitelist/{id}"},
		Aliases:     []string{"rm", "delete"},
		Short:       "Remove a whitelist entry by id",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			if !cmdutil.Confirm(fmt.Sprintf("Remove whitelist entry %d? New signups matching it will be blocked.", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := cmdutil.NewClient()
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
	cmdutil.AddYesFlag(cmd, &yes)
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
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/super-admin/errors"},
		Short:       "List error events (newest first)",
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
			c, err := cmdutil.NewClient()
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
					route := cmdutil.DerefOr(e.Route, "—")
					if e.Method != nil && *e.Method != "" {
						route = *e.Method + " " + route
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						e.ID, e.Level, triage, cmdutil.DerefOr(e.Code, "—"),
						cmdutil.Truncate(route, 32), cmdutil.Truncate(e.Message, 60), e.OccurredAt)
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
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/super-admin/errors/{id}"},
		Short:       "Show full detail for one error (stack + context)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, err := cmdutil.NewClient()
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
				fmt.Fprintf(tw, "Code\t%s\n", cmdutil.DerefOr(ev.Code, "—"))
				if ev.StatusCode != nil {
					fmt.Fprintf(tw, "HTTP\t%d\n", *ev.StatusCode)
				}
				route := cmdutil.DerefOr(ev.Route, "—")
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
		Use:         use,
		Annotations: map[string]string{"routes": "PATCH /api/super-admin/errors/{id}"},
		Short:       short,
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, err := cmdutil.NewClient()
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
		Use:         "delete <id> [<id> ...]",
		Annotations: map[string]string{"routes": "DELETE /api/super-admin/errors,DELETE /api/super-admin/errors/{id}"},
		Aliases:     []string{"rm"},
		Short:       "Permanently delete one or more error events",
		Args:        cobra.MinimumNArgs(1),
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
			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete %s? This cannot be undone.", noun), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := cmdutil.NewClient()
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
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newErrorsStatsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "stats",
		Annotations: map[string]string{"routes": "GET /api/super-admin/errors"},
		Short:       "Show aggregate error counts (total / open / resolved)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
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

package sales

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales contact` — the decision makers at a prospect.
//
// ---------------------------------------------------------------------------
// A CONTACT IS ADDRESSED BY ITS ID, AND A PROSPECT NEVER IS
// ---------------------------------------------------------------------------
// Every command here takes a PROSPECT #NUMBER first and a CONTACT ID second, and
// the asymmetry is deliberate rather than sloppy. A prospect is projected into
// the cross-app index and has a URN, so its address is the #number and its row
// id is never served. A contact has neither: it is always reached through its
// prospect, so its id is the only address there is — exactly as a comment is
// reached in the issue tracker.
//
// The ID column in `contact list` is what you paste into `edit` and `rm`.
func newContactCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "contact",
		Short: "Decision makers at a prospect",
	}
	cmd.AddCommand(
		newContactListCmd(),
		newContactAddCmd(),
		newContactEditCmd(),
		newContactRemoveCmd(),
	)
	return cmd
}

func newContactListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list <prospect>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/contacts"},
		Short:       "List a prospect's contacts",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListContacts(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tROLE\tEMAIL\tPHONE")
				for _, r := range rows {
					name := r.Name
					if r.IsPrimary {
						name = "★ " + name
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.ID, cmdutil.Truncate(name, 26), cmdutil.Truncate(r.Role, 26),
						dashIf(r.Email), dashIf(r.Phone))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no contacts)")
				}
				return nil
			})
		},
	}
}

func newContactAddCmd() *cobra.Command {
	var req client.ContactRequest
	var primary bool
	cmd := &cobra.Command{
		Use:         "add <prospect> --name <person>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/prospects/{n}/contacts"},
		Short:       "Add a contact to a prospect",
		Long: `Add a decision maker.

--primary marks this one as THE contact and demotes any other. At most one
prospect contact is primary at a time, and naming a new one is taken to mean the
old one is not — a 409 you would have to resolve in two calls is a worse product
than doing the obvious thing.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("primary") {
				req.IsPrimary = &primary
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.AddContact(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "added contact %d to prospect #%d: %s\n", row.ID, n, row.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Name, "name", "", "The person's name (required)")
	cmd.Flags().StringVar(&req.Role, "role", "", "Their role (\"Co-founder · product\")")
	cmd.Flags().StringVar(&req.Email, "email", "", "Email")
	cmd.Flags().StringVar(&req.Phone, "phone", "", "Phone")
	cmd.Flags().BoolVar(&primary, "primary", false, "Make this the primary contact")
	cmd.Flags().StringVar(&req.Notes, "notes", "", "Notes about this person")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newContactEditCmd() *cobra.Command {
	var req client.ContactRequest
	var primary bool
	cmd := &cobra.Command{
		Use:         "edit <prospect> <contact-id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}/contacts/{cid}"},
		Short:       "Edit a contact",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, cid, err := prospectAndChild(args, "contact")
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("primary") {
				req.IsPrimary = &primary
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.UpdateContact(ws, n, cid, req)
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated contact %d: %s\n", row.ID, row.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Name, "name", "", "The person's name")
	cmd.Flags().StringVar(&req.Role, "role", "", "Their role")
	cmd.Flags().StringVar(&req.Email, "email", "", "Email")
	cmd.Flags().StringVar(&req.Phone, "phone", "", "Phone")
	cmd.Flags().BoolVar(&primary, "primary", false, "Make this the primary contact")
	cmd.Flags().StringVar(&req.Notes, "notes", "", "Notes about this person")
	return cmd
}

func newContactRemoveCmd() *cobra.Command {
	var confirm string
	var yes bool
	cmd := &cobra.Command{
		Use:         "rm <prospect> <contact-id> --confirm <name>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/contacts/{cid}"},
		Short:       "Remove a contact from a prospect",
		Long: `Bin a contact.

--confirm must be the PERSON'S NAME at that id, not the id again. Repeating an
id back proves nothing about whether it is the right one.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, cid, err := prospectAndChild(args, "contact")
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the name of contact %d "+
					"— run `bk sales contact list %d` to see it", cid, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Read before the delete, so what is removed can be reported and so
			// the name can be checked against the row that would actually go.
			rows, err := c.ListContacts(ws, n)
			if err != nil {
				return err
			}
			var target *client.SalesContact
			for i := range rows {
				if rows[i].ID == cid {
					target = &rows[i]
					break
				}
			}
			if target == nil {
				return fmt.Errorf("no contact %d on prospect #%d — run `bk sales contact list %d`", cid, n, n)
			}
			if confirm != target.Name {
				return fmt.Errorf("--confirm is required to match contact %d, which is %q — got %q; nothing was deleted",
					cid, target.Name, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Remove %s from prospect #%d?", target.Name, n), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := c.RemoveContact(ws, n, cid)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "removed contact %d: %s\n", cid, done.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the contact's NAME to authorise the removal (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// prospectAndChild parses `<prospect> <child-id>` — a #number then a row id.
// One helper, so the asymmetry described at the top of this file is applied the
// same way by every command that has it.
func prospectAndChild(args []string, noun string) (int, int, error) {
	n, err := prospectNumber(args[0])
	if err != nil {
		return 0, 0, err
	}
	id, err := strconv.Atoi(strings.TrimSpace(args[1]))
	if err != nil || id <= 0 {
		return 0, 0, fmt.Errorf("invalid %s id %q — it is the ID column of `bk sales %s list %d`",
			noun, args[1], noun, n)
	}
	return n, id, nil
}

func dashIf(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

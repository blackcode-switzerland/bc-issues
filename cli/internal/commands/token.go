package commands

import (
	"fmt"
	"io"
	"strconv"

	"github.com/mustneerar7/blackcode-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newTokenCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "token",
		Aliases: []string{"tokens"},
		Short:   "Manage your API tokens",
	}
	cmd.AddCommand(
		newTokenListCmd(),
		newTokenCreateCmd(),
		newTokenDeleteCmd(),
	)
	return cmd
}

func newTokenListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List your API tokens",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			tokens, err := c.ListTokens()
			if err != nil {
				return err
			}
			return output.Render(format, tokens, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tPREFIX\tSCOPES\tLAST USED\tEXPIRES\tCREATED")
				for _, t := range tokens {
					scopes := ""
					for i, s := range t.Scopes {
						if i > 0 {
							scopes += ","
						}
						scopes += s
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						t.ID, t.Name, t.Prefix, scopes,
						derefOr(t.LastUsedAt, "never"),
						derefOr(t.ExpiresAt, "never"),
						derefOr(t.CreatedAt, ""))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(tokens) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no tokens)")
				}
				return nil
			})
		},
	}
}

func newTokenCreateCmd() *cobra.Command {
	var name, expiresAt string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new API token (the secret is shown once — copy it now)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			var exp *string
			if expiresAt != "" {
				exp = &expiresAt
			}
			tok, err := c.CreateToken(name, exp)
			if err != nil {
				return err
			}
			return output.Render(format, tok, func(w io.Writer) error {
				fmt.Fprintf(w, "Token created (id: %d, name: %s)\n", tok.ID, tok.Name)
				fmt.Fprintf(w, "Token: %s\n", tok.Token)
				fmt.Fprintln(w, "Copy the token now — it will not be shown again.")
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Token name (required)")
	cmd.Flags().StringVar(&expiresAt, "expires-at", "", "Expiry datetime in ISO 8601 (e.g. 2027-01-01T00:00:00Z)")
	return cmd
}

func newTokenDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Revoke an API token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if !Confirm(fmt.Sprintf("Revoke token #%d? Any scripts using it will stop working.", id), yes) {
				return fmt.Errorf("aborted")
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			if err := c.DeleteToken(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "revoked token #%d\n", id)
			return nil
		},
	}
	AddYesFlag(cmd, &yes)
	return cmd
}

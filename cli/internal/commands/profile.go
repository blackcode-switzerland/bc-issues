package commands

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newProfileCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "profile",
		Short: "View and edit your user profile",
	}
	cmd.AddCommand(
		newProfileViewCmd(),
		newProfileEditCmd(),
	)
	return cmd
}

func newProfileViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view",
		Short: "Show your profile",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			me, err := c.GetMe()
			if err != nil {
				return err
			}
			return output.Render(format, me, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:      %d\n", me.ID)
				fmt.Fprintf(w, "Email:   %s\n", me.Email)
				fmt.Fprintf(w, "Name:    %s\n", derefOr(me.Name, "—"))
				fmt.Fprintf(w, "Tagline: %s\n", derefOr(me.Tagline, "—"))
				if me.AvatarURL != nil {
					fmt.Fprintf(w, "Avatar:  %s\n", *me.AvatarURL)
				}
				return nil
			})
		},
	}
}

func newProfileEditCmd() *cobra.Command {
	var name, tagline, avatarURL string
	cmd := &cobra.Command{
		Use:   "edit",
		Short: "Update your profile (name, tagline, avatar URL)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !cmd.Flags().Changed("name") &&
				!cmd.Flags().Changed("tagline") &&
				!cmd.Flags().Changed("avatar-url") {
				return fmt.Errorf("provide at least one flag: --name, --tagline, --avatar-url")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			req := client.UpdateProfileRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("tagline") {
				req.Tagline = &tagline
			}
			if cmd.Flags().Changed("avatar-url") {
				req.AvatarURL = &avatarURL
			}
			me, err := c.UpdateProfile(req)
			if err != nil {
				return err
			}
			return output.Render(format, me, func(w io.Writer) error {
				fmt.Fprintf(w, "profile updated\n")
				fmt.Fprintf(w, "Name:    %s\n", derefOr(me.Name, "—"))
				fmt.Fprintf(w, "Tagline: %s\n", derefOr(me.Tagline, "—"))
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Display name (pass empty string to clear)")
	cmd.Flags().StringVar(&tagline, "tagline", "", "Short tagline, max 140 chars (pass empty string to clear)")
	cmd.Flags().StringVar(&avatarURL, "avatar-url", "", "Avatar image URL")
	return cmd
}

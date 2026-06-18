package commands

import (
	"fmt"
	"runtime/debug"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
	"github.com/spf13/cobra"
)

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the bk CLI version",
		RunE: func(cmd *cobra.Command, args []string) error {
			v := version.Version
			if v == "dev" {
				if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
					v = info.Main.Version
				}
			}
			out := cmd.OutOrStdout()
			fmt.Fprintln(out, v)
			if version.Commit != "" {
				fmt.Fprintf(out, "commit: %s\n", version.Commit)
			}
			if version.BuildDate != "" {
				fmt.Fprintf(out, "built:  %s\n", version.BuildDate)
			}
			return nil
		},
	}
}

package commands

import (
	"fmt"
	"runtime/debug"

	"github.com/spf13/cobra"
)

// Version, Commit, and BuildDate are overridden at build time by the
// Makefile via -ldflags "-X .../commands.Version=..." etc.
var (
	Version   = "dev"
	Commit    = ""
	BuildDate = ""
)

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the bk CLI version",
		RunE: func(cmd *cobra.Command, args []string) error {
			v := Version
			if v == "dev" {
				if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
					v = info.Main.Version
				}
			}
			out := cmd.OutOrStdout()
			fmt.Fprintln(out, v)
			if Commit != "" {
				fmt.Fprintf(out, "commit: %s\n", Commit)
			}
			if BuildDate != "" {
				fmt.Fprintf(out, "built:  %s\n", BuildDate)
			}
			return nil
		},
	}
}

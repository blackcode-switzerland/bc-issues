package commands

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newUploadCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "upload <file> [<file> ...]",
		Short: "Upload file(s) and print the public URL(s)",
		Long: `Upload one or more files (max 100MB each) and print the resulting public URL.

Use a URL in any description or comment to embed the file inline:
  ![name](url)   for images (inline preview)
  [name](url)    for any other file (video/audio player, or download card)

Unlike "bk issue attach", this does NOT create a sidebar attachment record — it
just stores the file and returns its URL. Tip: you can also reference a LOCAL
file path directly in --description/--body (e.g. ![](./shot.png)) and the CLI
will upload and embed it for you.`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := newClient()
			if err != nil {
				return err
			}
			results := make([]*client.UploadResponse, 0, len(args))
			for _, f := range args {
				up, err := c.UploadFile(f)
				if err != nil {
					return fmt.Errorf("upload %s: %w", f, err)
				}
				results = append(results, up)
			}
			return output.Render(format, results, func(w io.Writer) error {
				for _, up := range results {
					fmt.Fprintln(w, up.URL)
				}
				return nil
			})
		},
	}
}

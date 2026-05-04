package output

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

type Format string

const (
	FormatTable Format = "table"
	FormatJSON  Format = "json"
	FormatYAML  Format = "yaml"
)

const (
	flagOutput = "output"
	flagJSON   = "json"
	flagYAML   = "yaml"
	flagYML    = "yml"
)

func RegisterFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().StringP(flagOutput, "o", "table", "Output format: table | json | yaml | yml")
	cmd.PersistentFlags().Bool(flagJSON, false, "Shortcut for --output=json")
	cmd.PersistentFlags().Bool(flagYAML, false, "Shortcut for --output=yaml")
	cmd.PersistentFlags().Bool(flagYML, false, "Shortcut for --output=yaml")
}

func Resolve(cmd *cobra.Command) (Format, error) {
	jsonFlag, _ := cmd.Flags().GetBool(flagJSON)
	yamlFlag, _ := cmd.Flags().GetBool(flagYAML)
	ymlFlag, _ := cmd.Flags().GetBool(flagYML)
	output, _ := cmd.Flags().GetString(flagOutput)

	chosen := []string{}
	if jsonFlag {
		chosen = append(chosen, "json")
	}
	if yamlFlag || ymlFlag {
		chosen = append(chosen, "yaml")
	}
	if cmd.Flags().Changed(flagOutput) {
		chosen = append(chosen, strings.ToLower(strings.TrimSpace(output)))
	}
	if len(chosen) > 1 {
		set := map[string]struct{}{}
		for _, c := range chosen {
			set[normalize(c)] = struct{}{}
		}
		if len(set) > 1 {
			return "", errors.New("conflicting output flags: pick one of --output, --json, --yaml/--yml")
		}
	}

	picked := output
	if jsonFlag {
		picked = "json"
	} else if yamlFlag || ymlFlag {
		picked = "yaml"
	}
	return parseFormat(picked)
}

func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "yml" {
		return "yaml"
	}
	return s
}

func parseFormat(s string) (Format, error) {
	switch normalize(s) {
	case "", "table":
		return FormatTable, nil
	case "json":
		return FormatJSON, nil
	case "yaml":
		return FormatYAML, nil
	default:
		return "", fmt.Errorf("unknown output format %q (want: table | json | yaml | yml)", s)
	}
}

// Render writes data to stdout in the chosen format. For table format,
// the supplied tableFn is invoked with stdout to do the rendering;
// for json/yaml, the raw value is serialized.
func Render(format Format, data any, tableFn func(io.Writer) error) error {
	switch format {
	case FormatJSON:
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(data)
	case FormatYAML:
		enc := yaml.NewEncoder(os.Stdout)
		enc.SetIndent(2)
		defer enc.Close()
		return enc.Encode(data)
	default:
		if tableFn == nil {
			return errors.New("no table renderer for this command; use --json or --yaml")
		}
		return tableFn(os.Stdout)
	}
}

// Tabwriter returns a configured tabwriter writing to w.
func Tabwriter(w io.Writer) *tabwriter.Writer {
	return tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
}

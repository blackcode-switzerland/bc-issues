package commands

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/skill"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
	"github.com/spf13/cobra"
)

// UpdateAvailableError is returned by `bk skill check` / `bk skill sync` when a
// newer binary exists. main.go maps it to exit code 9 — a distinct code so an
// agent can branch on "I need to upgrade" without parsing stderr.
type UpdateAvailableError struct {
	Current, Latest string
}

func (e *UpdateAvailableError) Error() string {
	return fmt.Sprintf(
		"bk %s is behind %s — upgrade, then re-run:\n"+
			"  npm install -g @blackcode_sa/bc-issues@latest\n"+
			"  bk skill sync",
		e.Current, e.Latest)
}

// `bk skill` manages the agent skill file — the ~30-line pointer document a
// coding agent reads to learn that this project is driven by `bk`.
//
// It deliberately contains no facts that can rot: everything specific lives
// behind `bk guide` (static, embedded) and `bk meta` (dynamic, live). So the
// file is the same for everyone and `sync` is a cheap, safe thing to run.
func newSkillCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Install and keep the agent skill file current",
		Long: `Manage the agent skill file for blackcode issues.

The skill is a pointer, not a copy: it tells an agent to run ` + "`bk guide`" + ` for
usage and ` + "`bk meta`" + ` for live data. That is why it never goes stale on its
own — and why ` + "`bk skill sync`" + ` is the one command an agent is ever told to run.`,
	}
	cmd.AddCommand(
		newSkillInstallCmd(),
		newSkillPathCmd(),
		newSkillCheckCmd(),
		newSkillSyncCmd(),
		newSkillUninstallCmd(),
	)
	return cmd
}

// resolveTarget returns the directory the skill file belongs in: --dir when
// given, else the default (project-local .claude/, else ~/.claude/).
func resolveTarget(dirFlag string) (string, error) {
	if strings.TrimSpace(dirFlag) != "" {
		return filepath.Abs(dirFlag)
	}
	d, err := skill.DefaultDir()
	if err != nil {
		return "", err
	}
	return filepath.Abs(d)
}

func newSkillInstallCmd() *cobra.Command {
	var dirFlag, format string

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Write the agent skill file (default: ./.claude/skills/blackcode-issues/SKILL.md)",
		Long: `Write the agent skill file.

Target, in order of preference:
  --dir PATH                              explicit
  ./.claude/skills/blackcode-issues/      when a .claude/ exists in cwd or above
  ~/.claude/skills/blackcode-issues/      otherwise

  --format agents-md    instead append (or update in place) a delimited
                        "blackcode issues" section in ./AGENTS.md

Offline: the template ships inside this binary.`,
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if format == "agents-md" {
				return installAgentsMd(cmd, dirFlag)
			}
			if format != "" && format != "claude" {
				return fmt.Errorf("invalid --format %q (want: claude | agents-md)", format)
			}

			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			path := skill.FilePath(dir)
			if err := os.WriteFile(path, []byte(skill.Render(version.Version)), 0o644); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), path)
			fmt.Fprintf(cmd.ErrOrStderr(), "installed blackcode-issues skill (bk %s). Next: bk guide\n", version.Version)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to write the skill into (overrides the default target)")
	cmd.Flags().StringVar(&format, "format", "claude", "Container: claude (SKILL.md) | agents-md (a section in ./AGENTS.md)")
	return cmd
}

// installAgentsMd writes the same content into ./AGENTS.md, delimited by HTML
// comment markers so a re-run updates in place rather than appending a copy.
func installAgentsMd(cmd *cobra.Command, dirFlag string) error {
	base := strings.TrimSpace(dirFlag)
	if base == "" {
		var err error
		if base, err = os.Getwd(); err != nil {
			return err
		}
	}
	path := filepath.Join(base, "AGENTS.md")

	existing := ""
	if b, err := os.ReadFile(path); err == nil {
		existing = string(b)
	} else if !os.IsNotExist(err) {
		return err
	}

	updated := skill.UpsertAgentsSection(existing, skill.RenderAgentsSection(version.Version))
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), path)
	fmt.Fprintf(cmd.ErrOrStderr(), "updated the blackcode issues section in AGENTS.md (bk %s)\n", version.Version)
	return nil
}

func newSkillPathCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:         "path",
		Short:       "Print where the skill file would be (or already is)",
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), skill.FilePath(dir))
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to resolve against (overrides the default target)")
	return cmd
}

// skillStatus is the shared state `check` and `sync` both compute.
type skillStatus struct {
	Path            string `json:"path"`
	Installed       bool   `json:"installed"`
	InstalledFrom   string `json:"installed_from_cli_version"`
	RunningVersion  string `json:"running_cli_version"`
	LatestVersion   string `json:"latest_cli_version"`
	SkillIsCurrent  bool   `json:"skill_is_current"`
	BinaryIsCurrent bool   `json:"binary_is_current"`
}

// inspect gathers the local half (is the installed skill from this binary?) and,
// best-effort, the remote half (is this binary the latest?). The remote check is
// one cheap request whose only purpose is to read the X-BK-CLI-Latest header, so
// a network failure degrades to "assume current" rather than failing the command.
func inspect(dirFlag string) (skillStatus, error) {
	dir, err := resolveTarget(dirFlag)
	if err != nil {
		return skillStatus{}, err
	}
	st := skillStatus{
		Path:            skill.FilePath(dir),
		RunningVersion:  version.Version,
		BinaryIsCurrent: true,
	}

	if b, err := os.ReadFile(st.Path); err == nil {
		st.Installed = true
		st.InstalledFrom = skill.StampedVersion(string(b))
		st.SkillIsCurrent = st.InstalledFrom == version.Version
	} else if !os.IsNotExist(err) {
		return st, err
	}

	// One cheap call purely to harvest the version headers the API sets on every
	// response. `bk changelog`'s endpoint is public, so this works logged out.
	c := changelogClient("")
	_, _ = c.Changelog()
	st.LatestVersion = client.LatestSeen
	if st.LatestVersion != "" && version.Less(version.Version, st.LatestVersion) {
		st.BinaryIsCurrent = false
	}
	return st, nil
}

func newSkillCheckCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:   "check",
		Short: "Report whether the skill and the binary are current (exit 9 = update available)",
		Long: `Compare two things:
  a) the version stamp in the installed skill file vs. this binary
  b) this binary vs. the latest version the server advertises

Exit 0 = everything current. Exit 9 = something is behind; run ` + "`bk skill sync`" + `.`,
		Args: cobra.NoArgs,
		// The version headers are read off any response; the changelog endpoint
		// is the cheapest public one.
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			st, err := inspect(dirFlag)
			if err != nil {
				return err
			}

			render := func(w io.Writer) error {
				switch {
				case !st.BinaryIsCurrent:
					fmt.Fprintf(w, "bk %s is behind %s — run: bk skill sync\n", st.RunningVersion, st.LatestVersion)
				case !st.Installed:
					fmt.Fprintf(w, "no skill installed at %s — run: bk skill install\n", st.Path)
				case !st.SkillIsCurrent:
					fmt.Fprintf(w, "skill at %s was written by bk %s (running %s) — run: bk skill sync\n",
						st.Path, orNone(st.InstalledFrom), st.RunningVersion)
				default:
					fmt.Fprintf(w, "current: skill and bk %s are both up to date\n", st.RunningVersion)
				}
				return nil
			}
			if err := output.Render(format, st, render); err != nil {
				return err
			}
			if !st.BinaryIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, Latest: st.LatestVersion}
			}
			if !st.Installed || !st.SkillIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, Latest: st.RunningVersion}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to check (overrides the default target)")
	return cmd
}

func orNone(s string) string {
	if s == "" {
		return "an unknown version"
	}
	return s
}

func newSkillSyncCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:   "sync",
		Short: "Bring the agent skill (and, if needed, the binary) up to date",
		Long: `The one command an agent is ever told to run when something drifts.

  1. If a newer binary exists, print the exact upgrade command and exit 9.
     It does NOT self-mutate: this is an npm global install, and a
     self-replacing binary is fragile and often permission-blocked. Printing
     the command and returning a distinct exit code is more reliable, and an
     agent handles it fine.
  2. If the binary is current, rewrite the skill file from the embedded
     template and exit 0.`,
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := inspect(dirFlag)
			if err != nil {
				return err
			}
			if !st.BinaryIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, Latest: st.LatestVersion}
			}

			dir := filepath.Dir(st.Path)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(st.Path, []byte(skill.Render(version.Version)), 0o644); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), st.Path)
			fmt.Fprintf(cmd.ErrOrStderr(),
				"skill synced from bk %s. Read `bk guide` for current usage.\n", version.Version)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to sync (overrides the default target)")
	return cmd
}

func newSkillUninstallCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:         "uninstall",
		Short:       "Remove the installed skill file",
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			path := skill.FilePath(dir)
			if err := os.Remove(path); err != nil {
				if os.IsNotExist(err) {
					fmt.Fprintf(cmd.ErrOrStderr(), "nothing to remove at %s\n", path)
					return nil
				}
				return err
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "removed %s\n", path)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to remove from (overrides the default target)")
	return cmd
}

package cmdutil

import (
	"fmt"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// Construction of the API client, and the resolution of which workspace a
// command targets.
//
// This lives in cmdutil rather than in a command package because the command
// tree is split by app (internal/commands/platform, internal/commands/issues)
// and those packages must not import each other — PLATFORM-ARCHITECTURE.md §7.1.
// Anything two of them need is shared here, which is also what keeps "does app A
// reach into app B?" answerable by reading the import block.

// WSOverride is the per-invocation workspace target set by the persistent --ws
// flag; root.go binds it. When non-empty it overrides cfg.ActiveWorkspaceSlug
// for that command only — a read must never mutate the active workspace.
// VerboseFlag backs -v.
var (
	WSOverride  string
	VerboseFlag bool
)

// ClientWorkspaceSlug returns the workspace slug/id the client should target:
// the --ws override when set, otherwise the active workspace from config.
func ClientWorkspaceSlug(cfg *config.Config) string {
	if strings.TrimSpace(WSOverride) != "" {
		return WSOverride
	}
	return cfg.ActiveWorkspaceSlug
}

// NewClient builds an API client from the stored credentials.
func NewClient() (*client.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	return client.New(cfg.Server, cfg.Token, ClientWorkspaceSlug(cfg)), nil
}

// NewClientAndConfig is NewClient for the commands that also need the config
// itself (the active workspace, the cached user id).
func NewClientAndConfig() (*client.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	return client.New(cfg.Server, cfg.Token, ClientWorkspaceSlug(cfg)), cfg, nil
}

// ResolveWorkspaceRef returns either the slug/id explicitly given as the first
// argument, or the active workspace slug from config. Errors if there is no
// argument and no active workspace.
func ResolveWorkspaceRef(cfg *config.Config, args []string) (string, error) {
	if len(args) > 0 && args[0] != "" {
		return args[0], nil
	}
	if strings.TrimSpace(WSOverride) != "" {
		return WSOverride, nil
	}
	if cfg.ActiveWorkspaceSlug != "" {
		return cfg.ActiveWorkspaceSlug, nil
	}
	if cfg.ActiveWorkspaceID > 0 {
		return fmt.Sprintf("%d", cfg.ActiveWorkspaceID), nil
	}
	return "", fmt.Errorf("no active workspace — set one with `bk workspace use <slug>` or pass it explicitly")
}

// RequireActiveWorkspace is ResolveWorkspaceRef for commands that take no
// explicit workspace argument.
func RequireActiveWorkspace(cfg *config.Config) (string, error) {
	return ResolveWorkspaceRef(cfg, nil)
}

// DerefOr returns *s, or fallback when s is nil or points at "".
func DerefOr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return *s
}

// IntOr returns *p, or fallback when p is nil.
func IntOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}

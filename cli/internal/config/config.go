package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The stored credentials, and — since 3.0.0 — the APP ADDRESS BOOK (D-1).
//
// ---------------------------------------------------------------------------
// WHY ONE `server` FIELD STOPPED BEING ENOUGH
// ---------------------------------------------------------------------------
// There is more than one deployment: issues.blackcode.ch, sales.blackcode.ch.
// With a single address, `bk sales prospect list` would be sent to the issues
// host and come back 404 with nothing on screen naming the cause. That failure
// is invisible, and an invisible failure inside an agent run is one it cannot
// recover from.
//
// So the config carries a per-app map, LEARNED rather than configured:
// `bk login` and `bk meta` read `apps.<slug>.base_url` out of /api/meta and
// write it here. Nobody types a URL twice, and the registry cannot drift from
// what the platform actually serves for longer than one `bk meta`.
//
// One login, one token, one binary, one version floor — all unchanged. This is
// an address book, not a second account.
type Config struct {
	// Server is the LEGACY single address, kept written for two reasons: a
	// config touched by 3.x must still work if the user rolls back to 2.x, and
	// Load() migrates it forward when HomeServer is absent. It always mirrors
	// HomeServer after a Save.
	Server string `json:"server"`
	Token  string `json:"token"`

	// HomeApp is the app whose lens the NEUTRAL and CROSS-APP verbs use — whose
	// server answers `bk workspace list`, `bk search`, `bk meta`. Set by
	// `bk app use <slug>`, and learned on login from the app the login server
	// says it is. Empty is legal: it means "no lens", and those verbs simply go
	// to HomeServer.
	HomeApp string `json:"home_app,omitempty"`
	// HomeServer is where those verbs go.
	HomeServer string `json:"home_server,omitempty"`
	// AppServers maps an app slug to its base URL. An app-owned verb
	// (`bk <app> upload|trash|label`) and every command inside `bk <app> …`
	// resolves through this map and NEVER falls back — see cmdutil.ServerForApp.
	AppServers map[string]string `json:"app_servers,omitempty"`

	UserID              int    `json:"user_id,omitempty"`
	Email               string `json:"email,omitempty"`
	ActiveWorkspaceID   int    `json:"active_workspace_id,omitempty"`
	ActiveWorkspaceSlug string `json:"active_workspace_slug,omitempty"`
	// LastUpdateCheck is the unix timestamp (seconds) of the last time the CLI
	// printed the "update available" soft notice. Throttles it to once/24h.
	LastUpdateCheck int64 `json:"last_update_check,omitempty"`
}

func dir() (string, error) {
	if v := os.Getenv("BK_CONFIG_DIR"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "bk"), nil
}

func path() (string, error) {
	d, err := dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

func Load() (*Config, error) {
	p, err := path()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotConfigured
		}
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	c.migrate()
	return &c, nil
}

// migrate brings a config written by an older binary forward, in memory, on
// every read. It never writes: a `bk guide` run must not rewrite credentials.
//
// The only migration so far is the address book. A 2.x config has `server` and
// nothing else, and that address is by definition the home server — the one the
// user logged into. What it does NOT tell us is WHICH APP that server is, so
// `AppServers` stays empty and every app-scoped command fails with a hint
// naming `bk meta`, which populates it. That is a deliberate one-command
// upgrade step rather than a guess: guessing here means guessing which host a
// file gets uploaded to.
func (c *Config) migrate() {
	if c.HomeServer == "" {
		c.HomeServer = c.Server
	}
	if c.AppServers == nil {
		c.AppServers = map[string]string{}
	}
}

// SetAppServers replaces the registry with what a server reported, keeping the
// home server pointed at the same app it was.
//
// Entries with no base_url are DROPPED rather than stored empty: an app the
// platform has not given an address is one this binary cannot route to, and
// "no entry" is the state that produces the actionable error. A stored empty
// string would produce a request to "/api/…" against no host at all.
func (c *Config) SetAppServers(servers map[string]string) {
	clean := make(map[string]string, len(servers))
	for slug, url := range servers {
		url = strings.TrimRight(strings.TrimSpace(url), "/")
		if slug == "" || url == "" {
			continue
		}
		clean[slug] = url
	}
	c.AppServers = clean
	// Keep the home pointer consistent with the refreshed registry: if the home
	// app moved to a new URL, follow it.
	if c.HomeApp != "" {
		if url, ok := clean[c.HomeApp]; ok {
			c.HomeServer = url
		}
	}
}

func Save(c *Config) error {
	d, err := dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(d, 0o700); err != nil {
		return err
	}
	p, err := path()
	if err != nil {
		return err
	}
	// `server` mirrors `home_server` on every write. A 2.x binary reads only
	// `server`, so a user who rolls back keeps working — and a user who rolls
	// forward again finds the registry still there.
	if c.HomeServer != "" {
		c.Server = c.HomeServer
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o600)
}

func Delete() error {
	p, err := path()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

var ErrNotConfigured = errors.New("not configured: run `bk login` first")

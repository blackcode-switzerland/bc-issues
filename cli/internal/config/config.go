package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	Server              string `json:"server"`
	Token               string `json:"token"`
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
	return &c, nil
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

package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
)

// Exit codes are stable so LLMs / scripts can branch on outcome:
//
//	0  ok
//	1  generic / runtime error
//	2  bad usage (cobra arg/flag errors)
//	3  not authenticated (401, or no config)
//	4  permission denied (403)
//	5  not found (404)
//	6  validation error (400)
//	7  user aborted (declined a confirm prompt)
//	8  client too old; upgrade required (below API min version)
const (
	exitOK         = 0
	exitGeneric    = 1
	exitUsage      = 2
	exitAuth       = 3
	exitPermission = 4
	exitNotFound   = 5
	exitValidation = 6
	exitAborted    = 7
	exitOutdated   = 8
)

func main() {
	err := commands.NewRoot().Execute()

	// Hard floor: the API reported we're below the minimum supported version.
	// Print the upgrade requirement and exit with a distinct code.
	var oe *client.OutdatedError
	if errors.As(err, &oe) {
		fmt.Fprintf(os.Stderr,
			"Your bk version (%s) is no longer supported. Upgrade: npm i -g @blackcode_sa/bc-issues@latest\n",
			oe.Current)
		os.Exit(exitOutdated)
	}

	// On success or any other error, print the throttled soft update notice
	// before doing the normal error/exit handling.
	maybeNotifyUpdate()

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(classify(err))
	}
}

// maybeNotifyUpdate prints a once-per-24h "update available" notice to STDERR
// when the running version is older than the latest version the API reported.
// It writes only to stderr so it never corrupts --json output on stdout.
func maybeNotifyUpdate() {
	if !version.Parsable(version.Version) || client.LatestSeen == "" {
		return
	}
	if !version.Less(version.Version, client.LatestSeen) {
		return
	}

	cfg, err := config.Load()
	if err != nil {
		return
	}
	now := time.Now().Unix()
	if now-cfg.LastUpdateCheck < 86400 {
		return
	}

	fmt.Fprintf(os.Stderr,
		"A new bk version (%s) is available — upgrade: npm i -g @blackcode_sa/bc-issues@latest\n",
		client.LatestSeen)

	cfg.LastUpdateCheck = now
	_ = config.Save(cfg) // best-effort; ignore save errors
}

func classify(err error) int {
	if err == nil {
		return exitOK
	}
	if errors.Is(err, config.ErrNotConfigured) {
		return exitAuth
	}
	var ae *client.APIError
	if errors.As(err, &ae) {
		switch ae.Status {
		case 400, 422:
			return exitValidation
		case 401:
			return exitAuth
		case 403:
			return exitPermission
		case 404:
			return exitNotFound
		}
		return exitGeneric
	}
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "aborted"):
		return exitAborted
	case strings.Contains(msg, "required") || strings.HasPrefix(msg, "invalid "):
		return exitUsage
	}
	return exitGeneric
}

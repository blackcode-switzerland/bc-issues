package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/platform"
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
//	9  update available (bk skill check / sync found a newer binary)
const (
	exitOK          = 0
	exitGeneric     = 1
	exitUsage       = 2
	exitAuth        = 3
	exitPermission  = 4
	exitNotFound    = 5
	exitValidation  = 6
	exitAborted     = 7
	exitOutdated    = 8
	exitUpdateAvail = 9
)

func main() {
	err := commands.NewRoot().Execute()

	// Hard floor: the API reported we're below the minimum supported version.
	// Print the upgrade requirement and exit with a distinct code.
	var oe *client.OutdatedError
	if errors.As(err, &oe) {
		// Name the whole recovery, not just the upgrade: an agent blocked here
		// also has a stale skill, and refreshing it is what stops this recurring.
		fmt.Fprintf(os.Stderr,
			"This bk (%s) is no longer supported. Update and refresh your agent skill:\n"+
				"  npm install -g @blackcode_sa/bc-issues@latest\n"+
				"  bk skill install\n"+
				"  bk guide\n",
			oe.Current)
		os.Exit(exitOutdated)
	}

	// `bk skill check` / `bk skill sync` signal "a newer binary exists" with a
	// distinct exit code so an agent can branch on it without parsing stderr.
	var ue *platform.UpdateAvailableError
	if errors.As(err, &ue) {
		fmt.Fprintln(os.Stderr, ue.Error())
		os.Exit(exitUpdateAvail)
	}

	// On success or any other error, print the throttled soft update notice
	// before doing the normal error/exit handling.
	maybeNotifyUpdate()

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		// A one-line breadcrumb, but only at the moments an agent is actually
		// stuck (auth, drift-smelling 4xx, a command/flag that no longer exists).
		// stderr only, so --json stdout stays clean.
		if h := hintFor(err); h != "" {
			fmt.Fprintln(os.Stderr, "hint:", h)
		}
		os.Exit(classify(err))
	}
}

// hintFor returns a short recovery breadcrumb for the failure at hand, or "" when
// a hint would just be noise (e.g. a plain permission denial). The goal is a
// self-service loop: hit a wall -> follow the breadcrumb -> `bk changelog` /
// /agent-updator -> get current -> retry.
func hintFor(err error) string {
	if errors.Is(err, config.ErrNotConfigured) {
		return "run `bk login` to authenticate. New here? run `bk guide`"
	}
	// The registry has no address for the app this command must reach. The fix is
	// one command, and naming it is the difference between an agent recovering
	// inside this run and an agent stopping.
	var uae *cmdutil.UnknownAppError
	if errors.As(err, &uae) {
		return "run `bk meta` to learn each app's server from the platform, `bk app list` to see " +
			"what your config has now, or `bk login --server <url>` to point at a deployment directly"
	}

	// A known address that nothing answered at. The registry is learned, so the
	// entry itself may be what is wrong — and that is not something the caller can
	// guess from "connection refused". This has to come BEFORE the APIError branch
	// for the same reason it is its own type: it is not an answer from a server.
	var ue *client.UnreachableError
	if errors.As(err, &ue) {
		if ue.App != "" {
			return fmt.Sprintf(
				"that address came from your app registry — run `bk meta` to refresh it, "+
					"`bk app list` to see every app's server, or `bk login --server <url>` if the %s app moved",
				ue.App)
		}
		return "check the server is up and the address is right — `bk app list` shows what your config has, " +
			"`bk meta` refreshes it, `bk login --server <url>` replaces it"
	}

	var ae *client.APIError
	if errors.As(err, &ae) {
		// The server can name the fix itself — lib/api's Errors carry an optional
		// `suggestion`. When it does, that beats any guess we could make here.
		if s := strings.TrimSpace(ae.Suggestion); s != "" {
			return s
		}
		switch ae.Status {
		case 401:
			return "not authenticated — run `bk login`. New here? run `bk guide`"
		case 400, 404, 422:
			// The strongest drift signals: a shape or resource that used to work.
			return "if this used to work, the surface may have changed — run `bk skill sync`, then `bk guide` for current usage"
		case 410:
			return "that interface has been retired — run `bk guide` for the current way to do this"
		}
		return ""
	}

	msg := err.Error()
	if strings.Contains(msg, "unknown flag") ||
		strings.Contains(msg, "unknown command") ||
		strings.Contains(msg, "unknown shorthand") {
		// A named rename/removal beats the generic advice: it tells the agent the
		// new spelling, so it can retry inside the same run.
		if note := commands.DeprecationHint(msg); note != "" {
			return note +
				"\n      Run `bk guide` for current usage, or `bk skill sync` to update your agent skill."
		}
		return "that command or flag may have been renamed or removed — run `bk <group> --help` to see the current ones, `bk guide` for usage, or `bk skill sync` to update your agent skill"
	}
	return ""
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

	// Name the fix, not just the fact. `bk skill sync` is the single command an
	// agent is ever told to run: it reports the upgrade command when the binary
	// is behind, and refreshes the installed skill when it isn't.
	fmt.Fprintf(os.Stderr,
		"bk %s is behind %s — run: bk skill sync\n",
		version.Version, client.LatestSeen)

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
	case strings.Contains(msg, "required") || strings.HasPrefix(msg, "invalid "),
		// `bk guide pitfalls` once two sections define it: the caller named a
		// real topic imprecisely, which is bad usage (2), not a runtime fault (1).
		strings.HasPrefix(msg, "ambiguous "),
		strings.Contains(msg, "unknown flag"),
		strings.Contains(msg, "unknown command"),
		strings.Contains(msg, "unknown shorthand"),
		// Cobra's arg-count errors: "accepts 1 arg(s), received 0",
		// "requires at least 1 arg(s)", "accepts between 1 and 2 arg(s)".
		// These are bad usage, and the documented table above promises 2 for
		// "cobra arg/flag errors" — they were returning 1.
		strings.Contains(msg, "arg(s)"):
		return exitUsage
	}
	return exitGeneric
}

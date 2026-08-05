package commands

import (
	"regexp"
	"strings"
)

// Renamed or removed flags and commands, keyed by the OLD spelling.
//
// When a cobra usage error mentions one of these keys, main.go appends the
// value to the `hint:` line on stderr. That turns a dead run into a recovered
// one: the agent is told the new spelling and can retry immediately, instead of
// giving up on "unknown flag".
//
// THE RULE: add an entry here in the SAME commit as any rename or removal.
// Keep entries for two minor releases, then prune — a hint for a rename nobody
// remembers is just noise.
//
// Flag keys are written bare ("--assignee") so they match whatever command the
// user typed them on. Command keys are written as the path ("issue milestone").
var deprecations = map[string]string{
	// --- 1.9.0 (2026-08-03): the CLI became the only supported interface ---
	// Nothing was renamed in the CLI itself. `bk changelog --reference` lost its
	// backing document: the pinned Platform Reference is now the embedded guide.
	"--reference": "`bk changelog --reference` was retired on 2026-08-03 — the platform reference is now the embedded guide. Run `bk guide`.",

	// --- 1.10.0 (2026-08-04): app nouns moved behind the app name ---
	//
	// These six still RUN in 1.10.x and 1.11.x — aliases.go registers each old
	// spelling as a working, hidden copy that prints one deprecation line. The
	// rows below are what happens when those aliases are pruned in 1.12.0: cobra
	// answers `bk issue create` with `unknown command "issue" for "bk"`, and
	// hintFor() turns that into the new spelling instead of a dead end.
	//
	// PRUNE THESE IN THE SAME COMMIT AS THE ALIASES — one release after the
	// aliases go, not with them. A hint outlives the thing it replaces on
	// purpose; that gap is the only thing a stale script has left to read.
	"issue":     "`bk issue …` is now `bk issues issue …` — app verbs sit behind their app name. Same flags, same output.",
	"task":      "`bk task …` is now `bk issues task …` — app verbs sit behind their app name. Same flags, same output.",
	"project":   "`bk project …` is now `bk issues project …` — app verbs sit behind their app name. Same flags, same output.",
	"move":      "`bk move …` is now `bk issues move …` — app verbs sit behind their app name. Same flags, same output.",
	"copy":      "`bk copy …` is now `bk issues copy …` — app verbs sit behind their app name. Same flags, same output.",
	"analytics": "`bk analytics …` is now `bk issues analytics …` — it reports this app's statuses and priorities, so it moved with the app. Same flags, same output.",

	// --- 1.12.0 (2026-08-05): `bk undo` removed ---
	//
	// It never worked. `platform.transaction_log` had no writer, so the table was
	// empty in production and `undo` reported "0 operations" every time it was
	// run. A documented agent-facing command that does nothing is worse than a
	// missing one: an agent that believes it can undo takes risks it would not
	// otherwise take. Trash is the working undo and always was.
	"undo": "`bk undo` was removed in 1.12.0 — it never recorded anything and could not undo. Deletes are restorable: use `bk trash list` then `bk trash restore <type>:<#number>`.",
}

// flagRe pulls the offending token out of a cobra usage error, e.g.
// `unknown flag: --assignee` or `unknown command "milestone" for "bk issue"`.
var flagRe = regexp.MustCompile(`unknown (?:flag|shorthand flag): (-{1,2}[A-Za-z0-9-]+)`)
var cmdRe = regexp.MustCompile(`unknown command "([^"]+)" for "([^"]+)"`)

// DeprecationHint returns the migration note for the flag or command named in a
// usage error, or "" when there is no entry. Matching is exact on the flag
// spelling and, for commands, on both `<parent> <cmd>` and the bare `<cmd>`.
func DeprecationHint(errMsg string) string {
	if m := flagRe.FindStringSubmatch(errMsg); m != nil {
		if note, ok := deprecations[m[1]]; ok {
			return note
		}
	}
	if m := cmdRe.FindStringSubmatch(errMsg); m != nil {
		sub, parent := m[1], m[2]
		// parent is the full invocation path, e.g. `bk issue`. Drop the binary
		// name so the key reads `issue milestone`.
		parent = strings.TrimSpace(strings.TrimPrefix(parent, "bk"))
		if parent != "" {
			if note, ok := deprecations[parent+" "+sub]; ok {
				return note
			}
		}
		if note, ok := deprecations[sub]; ok {
			return note
		}
		// `sub` is cobra's whole remaining argv, not one word. A removed
		// TOP-LEVEL command is reported as `unknown command "issue list" for
		// "bk"` — so the lookup above misses `issue`, and the three most-used
		// spellings (`bk issue …`, `bk task …`, `bk project …`) fell through to
		// the generic hint while the single-word ones (`bk move`, `bk copy`,
		// `bk analytics`) matched. Found by running the built binary; the test
		// that should have caught it was asserting a hand-written single-word
		// error string instead of the one cobra actually emits.
		if first, _, found := strings.Cut(sub, " "); found {
			if note, ok := deprecations[first]; ok {
				return note
			}
		}
	}
	return ""
}

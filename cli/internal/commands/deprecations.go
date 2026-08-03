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
	}
	return ""
}

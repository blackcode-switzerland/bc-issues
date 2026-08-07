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

	// --- 3.0.0 (2026-08-06): the four app-owned verbs moved under the app ---
	//
	// D-11. `upload`, `trash` and `label` are the verbs whose ANSWER DEPENDS ON
	// THE APP: a file is attributed to the app that received it, a bin holds one
	// app's entities, a label is filtered by app. With one deployment a
	// bare spelling was correct; with two it has no correct answer, only a
	// default — and a default is how a sales contract gets filed under issues.
	//
	// Unlike the 1.10.0 rename, these rows are LIVE from day one: there is no
	// alias, because an alias would have to pick an app silently, which is the
	// exact accident being removed. The failure is loud and names its replacement.
	// Keep for two minor releases (through 3.2.0), then prune.
	"upload": "`bk upload …` is now `bk <app> upload …` — a file is stored against one app, so the app names itself: `bk issues upload contract.pdf`. Run `bk --help` for the apps this binary knows, or `bk guide platform/apps` for why.",
	"trash":  "`bk trash …` is now `bk <app> trash …` — each app has its own recycle bin, e.g. `bk issues trash list`. Run `bk guide platform/apps`.",
	"label":  "`bk label …` is now `bk <app> label …` — labels are filtered by app, e.g. `bk issues label list`. Run `bk guide platform/apps`.",

	// --- 3.1.0 (2026-08-07): the scaffold's slug is `scaffold`, not `template` ---
	//
	// D-38. Nothing a user deployed is affected — the scaffold app is never
	// deployed — but `bk template …` was in the advertised surface, in `bk --help`
	// and in `bk __routes`, so a script or an agent on stale context can have it.
	//
	// It was renamed because `template` is not a word this platform can spend on
	// an app: `sales` has a `template` ENTITY (`bk sales template list`, URN
	// `bc:sales:{ws}/template/{n}`), Go code has locals called `template`, and
	// guards that match text cannot tell the three apart. Four of them mis-fired
	// on the collision, the last one found on the day of the rename — a routing
	// test that kept passing because cobra's "unknown command \"template\"" also
	// contains the word it was asserting on.
	"template": "`bk template …` is now `bk scaffold …` — the scaffold app's slug was renamed on 2026-08-07 (D-38) because `template` collides with `bk sales template`. Same commands, same output: `bk scaffold note list`.",

	// `bk storage` itself STAYS BARE (D-28): one ledger, one quota, the same rows
	// from every app. Only its issues-only subcommand moved, and it moved to a
	// noun of that app rather than to `bk issues storage attachments` — one noun
	// must not straddle two tiers. Keyed `<parent> <sub>` because `bk storage`
	// still exists, so cobra reports this one against the GROUP.
	"storage attachments": "`bk storage attachments` is now `bk issues attachment list` — it lists issue attachments and only ever did, so it is a noun of that app. `bk storage list` is unchanged and still spans every app.",

	// --- 1.12.0 (2026-08-05): `bk undo` removed ---
	//
	// It never worked. `platform.transaction_log` had no writer, so the table was
	// empty in production and `undo` reported "0 operations" every time it was
	// run. A documented agent-facing command that does nothing is worse than a
	// missing one: an agent that believes it can undo takes risks it would not
	// otherwise take. Trash is the working undo and always was.
	"undo": "`bk undo` was removed in 1.12.0 — it never recorded anything and could not undo. Deletes are restorable: use `bk issues trash list` then `bk issues trash restore <type>:<#number>` (the recycle bin is per-app since 3.0.0).",
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
		// `sub` may be cobra's whole remaining argv rather than one word — e.g.
		// `unknown command "issue list" for "bk"` — in which case the lookup
		// above misses `issue` and the spelling falls through to the generic
		// hint. That is how `bk issue …`, `bk task …` and `bk project …` came to
		// get the useless hint while `bk move`, `bk copy` and `bk analytics`
		// matched; found by running the built binary, against a test that was
		// asserting a hand-written single-word string instead.
		//
		// MEASURED AGAIN 2026-08-06 on cobra v1.10.2, because the 1.13 verb move
		// depends on this path: the root now reports the FIRST token only
		// (`unknown command "upload" for "bk"`, from legacyArgs), and a group
		// reports the first token too (`… for "bk issues"`, from
		// rejectUnknownSubcommands' RunE). So today the branch below is
		// belt-and-braces, not the live path. It stays: it costs one map lookup,
		// the wording is cobra's to change, and cmd/bk/main_test.go now runs the
		// real tree so the live shape is measured on every build rather than
		// assumed here.
		if first, _, found := strings.Cut(sub, " "); found {
			if note, ok := deprecations[first]; ok {
				return note
			}
		}
	}
	return ""
}

// Package appverbs holds the platform verbs whose ANSWER DEPENDS ON THE APP —
// `upload`, `trash` and `label` — and builds one copy of them per app group, so
// they are spelled `bk issues upload`, `bk sales trash list`.
//
// ---------------------------------------------------------------------------
// WHY THEY ARE NOT BARE (D-11)
// ---------------------------------------------------------------------------
// Every `bk` verb sits in exactly one of three tiers, and the tier is visible in
// the command itself:
//
//	NEUTRAL    same answer from any deployment            bare   login, workspace, meta, …
//	CROSS-APP  spans every app by design, results tagged  bare   search, activity, link
//	APP-OWNED  the answer depends on the app              bk <app> <verb>
//
// These three are the third tier. A file, a recycle bin and a label each belong
// to ONE app: `platform.uploads.app` records who uploaded a file, the bin lists
// that app's deleted entities, and a label is filtered by app. With two
// deployments a bare `bk upload` has no correct answer — it has a DEFAULT, and a
// default is how a sales contract gets filed under issues. A flag can be
// forgotten; a namespace cannot.
//
// `bk storage` IS NOT HERE, and the near-miss is the useful part (D-28). It looks
// like it belongs: it is the cabinet behind `upload`, and it moved here for one
// commit. But uploads are one ledger with one workspace quota, so every app
// returns the SAME rows — the answer does not depend on the app, and an
// app-scoped spelling would have taught an agent that it does. The pairing to
// remember: **you upload into one app; you list across all of them.** The test is
// never "is it shared code?"; it is "would two deployments answer differently?".
//
// ---------------------------------------------------------------------------
// WHY THE IMPLEMENTATION LIVES HERE AND NOT IN A COMMAND PACKAGE
// ---------------------------------------------------------------------------
// `internal/commands/<app>` packages must not import each other, and must not
// import `internal/commands/platform` (commands/boundaries_test.go). So a verb
// two app groups both mount cannot live in either of them, and it cannot live in
// `platform` — an app package could not reach it.
//
// It sits outside `internal/commands/` for the same reason `cmdutil` does: that
// is the sanctioned place for what several command packages share. What is here
// is only the app-agnostic half. Anything that names one app's entities —
// `bk issues label attach <issue>`, `bk issues storage attachments` — is built in
// that app's own package and added to the group returned by New(). That split is
// deliberate: it is what lets the parity guard check each claim against the app
// that actually serves the route.
//
// ADDING AN APP: one line in the app's group constructor —
//
//	cmd.AddCommand(appverbs.New(appverbs.Config{App: Slug, TrashTypes: …}).All()...)
//
// and nothing else. An app that mounts the platform route factories but forgets
// this line fails its own `lib/cli-parity.test.ts`: `POST /api/upload` is real in
// its tree and no `bk` command claims it.
package appverbs

import (
	"strings"

	"github.com/spf13/cobra"
)

// Config is what the shared verbs need to know about the app mounting them.
type Config struct {
	// App is the app slug — the first segment of `bk <app> upload`, the key in
	// `bk meta`'s apps object, and (from Phase 1d) the key that picks which
	// server the command talks to. Never a default: the group PINS it.
	App string

	// TrashTypes are this app's binnable entity types, in the spelling a
	// `<type>:<#number>` ref uses. They are validated locally so a typo costs
	// nothing instead of a round-trip.
	//
	// This is one app's vocabulary, so it is passed in rather than listed here —
	// the platform has no business inventing another app's nouns. Empty means no
	// local validation and the server decides, which is a legitimate choice for
	// an app whose vocabulary changes often; it is not a legitimate accident, so
	// state it explicitly at the call site.
	TrashTypes []string
}

// Set is one app's copy of the four app-owned verbs.
//
// The groups are returned individually as well as through All() because an app
// adds its own entity-specific subcommands to them: `bk issues label attach`
// takes an issue and posts to an issues route, so it is built in the issues
// package and hung off Label here.
type Set struct {
	Config Config
	Upload *cobra.Command
	Trash  *cobra.Command
	Label  *cobra.Command
}

// All returns the groups in the order `bk <app> --help` should list them.
func (s Set) All() []*cobra.Command {
	return []*cobra.Command{s.Upload, s.Trash, s.Label}
}

// New builds one app's copy of the app-owned verbs.
//
// A fresh construction per app, never a shared pointer: a cobra command carries
// per-invocation state (parsed flags, its parent link), so the same
// *cobra.Command cannot hang off two app groups.
func New(cfg Config) Set {
	if strings.TrimSpace(cfg.App) == "" {
		// Every one of these commands is defined by which app it targets. An
		// empty slug would build a tree that looks right and routes nowhere —
		// fail at construction, where every test that builds the command tree
		// sees it, rather than at the first HTTP call.
		panic("appverbs.New: Config.App is required — these verbs are app-owned by definition")
	}
	return Set{
		Config: cfg,
		Upload: newUploadCmd(cfg),
		Trash:  newTrashCmd(cfg),
		Label:  newLabelCmd(cfg),
	}
}

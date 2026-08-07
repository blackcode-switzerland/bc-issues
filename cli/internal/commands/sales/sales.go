// Package sales holds the command tree for the sales app — everything under
// `bk sales …`.
//
// One Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1, enforced by commands/boundaries_test.go).
// Anything two apps need lives in internal/cmdutil or internal/appverbs; anything
// only this app needs lives here. Reading this package's import block is meant to
// be enough to answer "does sales reach into another app?".
//
// ---------------------------------------------------------------------------
// THE GROUP PINS ITS APP (D-1)
// ---------------------------------------------------------------------------
// `bk sales …` always talks to `app_servers["sales"]`. It is not affected by
// `bk app use`, by `--app-server`, or by whatever the previous command did — the
// pin is applied to the whole subtree in commands/root.go, so there is no
// spelling under this group that can reach the wrong deployment. An app with no
// entry in the registry is a hard failure naming itself and the command that
// fixes it, never a request quietly sent home.
package sales

import "github.com/spf13/cobra"

// Slug is this app's name — the first segment of `bk sales …`, the key in
// `bk meta`'s apps object, the Postgres schema, and the primary key in
// platform.apps. One spelling, used everywhere.
const Slug = "sales"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Business development — prospects, the pipeline, meetings and the catalog"

const long = `The sales app: the business-development pipeline.

  bk sales prospect   the core object — a company AND its deal in one:
                      list, show, create, edit, stage, delete

THE DOCTRINE, because it explains what is missing: the agent operates the
funnel and the human supervises. Nothing here computes — matches, aggregates and
next actions are WRITTEN, by you, through these commands. The app never sends an
email; it records that one was sent.

Vocabularies (stages, channels, meeting types, …) and every limit are served
live by "bk meta". They change without a release of this binary, so this help
text does not list them.

Identity and org verbs — workspace, member, invite, token, profile, inbox — are
NEUTRAL and stay bare, as are the cross-app ones: search, activity, link, and
"bk storage". Run "bk guide platform/apps" for the three tiers.`

// NewGroup returns the `bk sales` command group. Registered from
// commands/root.go, exactly as an app's group should be.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	return cmd
}

// nouns is this app's surface — what `bk sales` offers today.
//
// There is no `LegacyTopLevel` counterpart to the issues package's: no sales
// verb has ever had a bare spelling, so there is no migration to keep a
// deprecation hint for. Adding one would assert a rename that never happened.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		newProspectCmd(),
	}
}

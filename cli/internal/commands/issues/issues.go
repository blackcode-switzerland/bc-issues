// Package issues holds the command tree for the issues app — everything under
// `bk issues …`.
//
// It is one Go package per app, and app packages do not import each other
// (PLATFORM-ARCHITECTURE.md §7.1). Anything two apps need lives in
// internal/cmdutil; anything only this app needs lives here. Reading the import
// block of this package is meant to be enough to answer "does issues reach into
// another app?".
//
// Why the app name is a required segment, when there is exactly one app: it
// removes noun collisions before they can happen. Every app eventually wants
// `report`, `note`, `status` — and `bk sales deal create` says which app it is
// while `bk deal create` does not. Doing it with one app is a rename; doing it
// with three is a migration with N callers.
package issues

import "github.com/spf13/cobra"

// Slug is this app's name — the first segment of `bk issues …`, the key in
// `bk meta`'s apps object, and the primary key in platform.apps. One spelling,
// used everywhere.
const Slug = "issues"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Issue tracker — issues, tasks, projects, analytics"

const long = `The issues app: projects, issues, tasks, their comments and their analytics.

  bk issues issue     list, view, create, edit, delete, assign, watch, comment(s),
                      edit-comment, delete-comment, attach, detach, activity
  bk issues task      list, view, create, edit, delete, comment(s)
  bk issues project   list, view, create, edit, delete, members, updates, comment(s)
  bk issues move      move projects/tasks/issues to another workspace (--to)
  bk issues copy      the same, leaving the source in place
  bk issues analytics summary, throughput and distributions for this app

Workspaces, labels, files, members, invitations, trash and undo are PLATFORM
verbs and stay at the top level — they are shared by every app, so they are not
repeated here. Run "bk --help" for those.

Every command below also answers to its old un-namespaced spelling
("bk issue list"), which still works and prints one deprecation line. See
"bk changelog".`

// NewGroup returns the `bk issues` command group — the canonical spelling.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	return cmd
}

// LegacyTopLevel returns a SECOND, independent copy of the same nouns, for the
// root to register under their old bare names as deprecated aliases.
//
// It is a fresh construction rather than a shared pointer on purpose: cobra
// commands carry per-invocation state (parsed flags, parent links), so the same
// *cobra.Command cannot hang off two parents. Building both trees from one
// nouns() list is also what makes the alias impossible to drift — there is no
// second definition of what `issue create` does, only a second way to reach the
// one definition.
func LegacyTopLevel() []*cobra.Command {
	return nouns()
}

func nouns() []*cobra.Command {
	return []*cobra.Command{
		newIssueCmd(),
		newTaskCmd(),
		newProjectCmd(),
		newMoveCmd(),
		newCopyCmd(),
		newAnalyticsCmd(),
	}
}

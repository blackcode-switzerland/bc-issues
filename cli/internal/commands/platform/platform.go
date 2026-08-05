// Package platform holds the command tree that is true for every app —
// identity, workspaces, membership, labels, files, tokens, trash, undo and the
// agent surface itself (guide, meta, changelog, skill).
//
// These are the verbs that stay BARE: `bk workspace list`, not
// `bk issues workspace list`. A workspace is the company and an app is a
// capability inside it (PLATFORM-ARCHITECTURE.md §4.4), so namespacing them per
// app would claim a boundary that does not exist and would give a person three
// workspace lists for one company.
//
// The rule for deciding where a new command goes is the same one that decided
// the database schema: would a sales app need this unchanged? Labels, uploads,
// members and the inbox — yes, those are org concepts. Statuses, priorities and
// throughput charts — no, those are one app's vocabulary, and they live in
// internal/commands/<app>/.
//
// This package must not import any app package, and no app package may import
// it. Anything both need is in internal/cmdutil.
package platform

import "github.com/spf13/cobra"

// NewCommands returns every bare platform verb, in the order `bk --help` should
// present them. root.go adds these, then one group per app.
func NewCommands() []*cobra.Command {
	return []*cobra.Command{
		newGuideCmd(),
		newSkillCmd(),
		newLoginCmd(),
		newLogoutCmd(),
		newWhoamiCmd(),
		newMetaCmd(),
		newProfileCmd(),
		newWorkspaceCmd(),
		newAppCmd(),
		newUserCmd(),
		newLabelCmd(),
		newMemberCmd(),
		newInviteCmd(),
		newInboxCmd(),
		newTokenCmd(),
		newActivityCmd(),
		newSearchCmd(),
		newLinkCmd(),
		newUploadCmd(),
		newStorageCmd(),
		newTrashCmd(),
		newChangelogCmd(),
		newSuperAdminCmd(),
		newVersionCmd(),
	}
}

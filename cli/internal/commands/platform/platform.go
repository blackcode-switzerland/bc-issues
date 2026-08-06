// Package platform holds the BARE verbs — the ones that stay at the top level
// because no app can be the wrong one to ask.
//
// Two of the three tiers in docs/sales-app-plan.md D-11 live here:
//
//	NEUTRAL    identical answer from any deployment. login, logout, meta, guide,
//	           changelog, skill, version, app, workspace, member, invite, token,
//	           profile, inbox, super-admin. These are identity and org data; a
//	           workspace is the company and an app is a capability inside it
//	           (docs/platform-architecture.md §4.4), so namespacing them per app
//	           would claim a boundary that does not exist and would give a person
//	           three workspace lists for one company.
//
//	CROSS-APP  spans every app BY DESIGN, and tags each result with the app it
//	           came from. search, activity, link. Making these app-scoped would
//	           destroy the thing they exist for.
//
// The third tier — `upload`, `storage`, `trash`, `label`, whose answer depends
// on the app — moved to `bk <app> <verb>` in 2.1.0 and lives in
// internal/appverbs. Read that package's header before adding a command here:
// the question is not "is it shared code?" but "would two deployments give the
// same answer?". A label, a file and a recycle bin would not.
//
// This package must not import any app package, and no app package may import
// it. Anything both need is in internal/cmdutil or internal/appverbs.
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
		newMemberCmd(),
		newInviteCmd(),
		newInboxCmd(),
		newTokenCmd(),
		newActivityCmd(),
		newSearchCmd(),
		newLinkCmd(),
		newChangelogCmd(),
		newSuperAdminCmd(),
		newVersionCmd(),
	}
}

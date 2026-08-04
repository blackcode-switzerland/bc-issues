# Issues pitfalls — the mistakes specific to this app

The platform pitfalls list (`bk guide platform/pitfalls`) covers the mistakes
that bite in every app — wrong workspace, literal `\n`, assuming a vocabulary.
These are the ones that only happen here.

**1. Treating a `#number` as global.** It is unique per workspace only. The same
`#42` exists in every workspace you belong to and means something different in
each. Never carry one across workspaces — and after a move or copy, re-read the
new ids from the response rather than assuming they survived.
→ `bk guide issues/items`, `bk guide issues/move-copy`

**2. Re-creating items to move them.** Deleting an issue in one workspace and
creating it in another loses its comments, attachments, labels and watchers, and
there is no way back once the original is purged. `bk issues move` and
`bk issues copy` carry all of it in one transaction.
→ `bk guide issues/move-copy`

**3. Assuming a `#number` is the database id.** It is not, and the database id is
never exposed. Every command that takes an issue, task or project takes the
`#number` you can see — `bk issues issue view 42` and `bk issues issue view #42`
are the same call.

**4. Filtering by a status or priority you guessed.** This app's vocabularies are
served live by `bk meta` under `apps.issues`, because they change without a CLI
release. A hardcoded status is how an integration silently stops matching
anything — the filter does not fail, it returns nothing.

Related commands: `bk issues issue`, `bk issues task`, `bk issues project`, `bk meta`

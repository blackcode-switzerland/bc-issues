# Cross-app: URNs, search and links

Every addressable thing in every app has one name that works everywhere. That is
what lets you search across apps, read one merged activity feed, and record that
a thing in one app blocks a thing in another.

## The URN

```
bc:<app>:<workspace-slug>/<entity-type>/<number>
bc:issues:kali-sa/issue/482
```

Three things about it, and each one matters when you construct or compare one:

- **`<number>` is the workspace #number** — the `#N` shown in the app and printed
  by every list command. It is never the internal database id. This is the same
  rule the rest of the CLI follows.
- **`<workspace-slug>` is the slug, not the id.** So a URN is readable, and so
  the tenant it belongs to is visible without a lookup.
- **`<app>` comes first**, which is what tells you — and the server — which app
  owns the thing without having to go and find out.

Do not hand-assemble a URN from parts you guessed. Get one from `bk search`, or
from the `subject_urn` field on an activity entry. Run `bk meta` for the app
slugs you can reach and the entity types each one publishes.

## Search across every app

```bash
bk search auth                       # titles matching "auth", any app
bk search "#482"                     # by workspace #number
bk search acme --type issue,project  # narrow by entity type
bk search acme --app issues --json   # narrow by app
bk search draft --include-deleted    # include items in the recycle bin
```

Output carries the URN, which is what `bk link` takes.

This searches **titles and #numbers only**, across every app. To search
descriptions, or to filter by status, assignee or label, use that app's own
listing instead — for the issue tracker, `bk issues issue list --search`.

## Linking two things

Links are **directed** and stored once. `A blocks B` is a single relation: it
shows up as an outgoing link on A and an incoming one on B. There is no separate
inverse row to keep in step.

```bash
bk link create bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
bk link list bc:issues:acme/issue/12
bk link rm bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
```

Run `bk meta` for the relation names this server accepts — they are served under
`links.relations` and can change without a new binary, so they are deliberately
not listed here.

Four rules the server enforces, each with a distinct error you can branch on:

- **Both ends must exist.** Linking to something that is not there fails with
  exit 5 and names which end was missing. If you just created the target, you
  already have its #number — build the URN from that.
- **Both ends must be in the same workspace.** A link is the one thing that names
  two records at once, so crossing a tenant boundary is refused, not merged.
- **Nothing links to itself.**
- **Creating the same link twice succeeds.** It reports `created: false` the
  second time. Retrying after a timeout is safe and is not an error.

`bk link rm` needs all three parts — from, to *and* rel — because direction is
part of the identity. Check it with `bk link list` first rather than guessing.

## What happens to links when things are deleted

- **Binned** (`bk trash`): the link survives, and `bk link list` shows the far
  end flagged as in the trash. Restoring brings it back intact.
- **Purged** (permanently deleted): the link goes with it. A relation to
  something that no longer exists anywhere is a dangling pointer, not a fact.
- **Workspace renamed**: every URN in it is rewritten and the links follow
  automatically. A URN you cached before a rename will stop resolving — get a
  fresh one from `bk search` rather than storing them long-term.

## One activity feed across apps

```bash
bk activity --since 24h
bk activity --since 7d --app issues
bk activity --subject bc:issues:kali-sa/issue/482
bk activity --ws kali-sa --since 30m --json
```

`--since` takes a relative window: `30m`, `24h`, `7d`. Each entry carries the
`app` that produced it and, where its subject is an addressable entity, that
entity's `subject_urn` — so `--subject` gives you the full history of one thing
in one call.

Entries about members, invitations, labels and comments have no `subject_urn`.
That is an answer, not a gap: those are real events about things that have no
cross-app address.

Related commands: `bk search`, `bk link create|list|rm`, `bk activity`, `bk meta`

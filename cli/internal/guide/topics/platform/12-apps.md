# Apps — which app is this command talking to?

One binary, one login, one workspace list — and more than one app. This topic is
the rule that keeps that from being confusing: **every `bk` verb belongs to
exactly one of three tiers, and the spelling tells you which.**

Read it before your first write. Getting a tier wrong is not a syntax error —
it is a file, a label or a deleted item landing in the wrong app, where nothing
downstream can tell it was a mistake.

## The three tiers

**1. Neutral — bare, and the same answer from any app.**

```bash
bk login          bk logout         bk meta           bk guide
bk workspace      bk member         bk invite         bk token
bk profile        bk inbox          bk app            bk changelog
bk skill          bk version        bk super-admin
```

These touch identity and organisation data. A workspace is the company; an app
is a capability inside it. No app owns a person, a membership or an invitation,
so no app can be the wrong one to ask — and namespacing them would hand you
three workspace lists for one company.

**2. Cross-app — bare, and crossing the boundary is the whole point.**

```bash
bk search "acme"        # hits from EVERY app, each tagged with the app it is in
bk activity             # one merged feed; --app narrows it
bk link create …        # relate two things that live in different apps
bk storage list         # every app's files, one workspace quota; --app filters
```

Results are tagged with the app they came from, and addresses are URNs
(`bc:<app>:<workspace>/<type>/<number>`), so an answer is never ambiguous about
where it lives. Scoping these to one app would remove the only reason they
exist. See `bk guide platform/cross-app`.

**3. App-owned — behind the app's name, because the answer depends on the app.**

```bash
bk issues issue create --title "…"     # this app's nouns
bk issues upload contract.pdf          # …and these three, which used to be bare
bk issues trash list
bk issues label list
```

`upload`, `trash` and `label` moved behind the app name in 3.0.0. They look
shared, and they are not:

| Verb | Why it belongs to one app |
|---|---|
| `upload` | the file records which app received it, and lands under that app's prefix |
| `trash` | each app has its own recycle bin, holding its own entities |
| `label` | labels are filtered by app, and attaching one names an entity in that app |

### Files: you upload INTO one app, and you list ACROSS all of them

This is the one pairing worth memorising, because the two halves sit in
different tiers on purpose:

```bash
bk issues upload contract.pdf   # APP-OWNED: the file is filed under issues
bk storage list                 # CROSS-APP: every app's files, tagged by app
bk storage list --app issues    # …filtered, if you only want one app's
```

Uploading is a choice about ownership — the file is permanently attributed to
the app that received it and stored under that app's prefix — so the app has to
be in the command. Listing is not: uploads are ONE ledger against ONE workspace
quota, so every app returns the same rows. An app-scoped `storage list` would
have suggested the app narrows the answer, and then not narrowed it.

The test to apply when you are unsure: **would two deployments answer
differently?** If yes, the app is in the command.

## Why a namespace and not a `--app` flag

A flag can be forgotten, and a forgotten flag falls back to a default. A
namespace cannot be forgotten: there is no bare form to type. `bk issues upload`
reads exactly like `bk issues issue create`, so learning one teaches the other.

That is also why the old bare spellings were removed outright instead of being
kept as aliases for a while. An alias would have to pick an app silently, which
is the accident being removed. Instead:

```
error: unknown command "upload" for "bk"
hint: the bare spelling is now `bk <app> upload …` — a file is stored against
      one app, so the app names itself: `bk issues upload contract.pdf`.
```

Non-zero exit, one line on stderr, and the replacement named — recoverable
inside the same run.

## Which apps exist, and which you can reach

```bash
bk --help          # the app groups this BINARY has
bk meta            # the apps this TOKEN can reach, live, plus a `routing` block
bk <app> --help    # one app's commands
bk app list        # every app here: enabled, its server, and whether it answers
```

`bk --help` and `bk meta` answer different questions, and the difference matters:
a binary can know an app you have no access to, and a deployment can offer one
your binary is too old to have. When they disagree, `bk meta` is the live truth
and `bk skill sync` is how the binary catches up.

## Where a command actually goes

Each app is its own deployment, so "which app" is also "which server". The CLI
keeps an **address book** — learned from the platform, never typed — and routes
by tier:

| Tier | Server |
|---|---|
| Neutral | the **home app**'s |
| Cross-app | the home app's (it reads shared data, so any app answers alike) |
| App-owned | **that app's**, always — `bk <app> …` pins it |

```bash
bk meta                      # refreshes the address book; prints where each tier goes
bk app list                  # every app, its server, and whether it answers for you
bk app use sales             # move the home app: the bare verbs now go to sales
```

**Upgrading from bk 2.x? Run `bk meta` once.** A 2.x config has no address book,
and `bk` will not invent one — `bk <app> …` fails naming this command until it
has been learned. Your login still works; nothing else is needed.

`bk <app> …` ignores all of that. Its app is written on the command, so no mode,
default or previous command can move it — which is the property that makes a
namespace safer than a flag.

### `--app-server` — the escape hatch, and when to reach for it

Almost never. `bk app use <slug>` is how you change where the bare verbs go, and
it is the right answer whenever you are going to run more than one command.

`--app-server <slug>` redirects a SINGLE invocation and changes nothing on disk.
Use it for a one-off look at another app's deployment — checking `bk meta` or
`bk workspace list` through sales while you stay homed on issues — or in a script
that must not disturb the config it found. If you are typing it twice, you wanted
`bk app use`.

```bash
bk --app-server sales meta      # one look at sales, home app unchanged
```

It cannot move an app-owned verb: `bk --app-server sales issues upload x.pdf`
still uploads to issues. The name on the command wins over the flag, always.

**The flag is `--app-server`, not `--app`.** `--app` already means "filter by
app" on `bk search`, `bk activity`, `bk storage list`, `bk changelog` and
`bk guide`. One name, two meanings, would be a coin flip.

## When routing fails, it says so

The CLI never guesses an address. An app it has no server for is an error naming
the app, never a request sent to a different one — a wrong-host answer looks
exactly like a missing record, and you would have no way to tell:

```
error: no server known for app "sales" (registry has: issues)
hint: run `bk meta` to learn each app's server from the platform, `bk app list`
      to see what your config has now, or `bk login --server <url>`
```

An address that is known but dead says that instead, naming the app and the URL,
so a stale address book and a down deployment are distinguishable.

## Working across two apps

Nothing forces you to pick one. The normal shape is: work in the app that owns
the thing, and use the cross-app tier to join them.

```bash
bk issues issue create --title "Export fails for large accounts"
bk link create bc:issues:acme/issue/512 blocks bc:sales:acme/prospect/8
bk search "acme"        # both apps, each hit tagged
```

The rule of thumb, if you remember nothing else: **if the answer would differ
between two deployments, the app is in the command.** If it would not, the verb
is bare.

Related commands: `bk --help`, `bk meta`, `bk app list`, `bk app use`, `bk issues upload`, `bk issues trash list`, `bk storage list`, `bk search`, `bk link`

# Crossing app boundaries: URNs, links, and the round trip

Work in this app regularly turns into work somewhere else — a client asks for
something that is an engineering problem, and the two records need to point at
each other. This page is that round trip, end to end.

Related commands: `bk sales prospect show`, `bk search`, `bk link create`,
`bk link list`, `bk activity`.

## Everything addressable has a URN

A record with a #number also has a cross-app address:

```
bc:sales:<workspace>/prospect/<n>
bc:sales:<workspace>/meeting/<n>
```

Run `bk meta` for the full list of addressable types in this app — it grows, so
this page does not enumerate it. Records without a #number (contacts, journey
steps, objections, matches) have no URN, because an address nothing can resolve
is worse than not being addressable.

`bk sales prospect show <n>` prints the prospect's URN at the top. That string is
what every command below takes.

## Finding something you cannot name precisely

Two different questions, two different commands:

```bash
bk search "roches"            # across EVERY app, by title. Returns URNs.
bk sales search "roches"      # inside THIS app's text. Returns records.
```

The first reads the shared index, which holds titles only, and tags each hit with
the app it came from. The second reads this app's own full-text columns and can
find a phrase in a call summary — something the shared index does not contain.
`bk guide sales/pitfalls` has more on choosing.

## Relating two records

```bash
bk link create bc:sales:<ws>/prospect/12 bc:issues:<ws>/issue/512 --rel blocks
bk link list bc:sales:<ws>/prospect/12
```

`bk link` is a **bare, cross-app verb**: relating two records is the whole point
of it, so it is not behind any app's name. Run `bk meta` for the relation
vocabulary — it is served live and this page does not restate it.

Both ends must be real. A URN that nothing has projected is refused rather than
stored, so a link cannot silently point at nothing.

## The round trip, worked

An agent is working a deal and finds that what the client needs is a change to
the product.

```bash
# 1. where you are
bk sales prospect show 12
#    → bc:sales:acme/prospect/12

# 2. record the engineering work in whichever app owns it, and note its URN

# 3. relate them
bk link create bc:sales:acme/prospect/12 <that URN> --rel blocks

# 4. and back — the prospect now shows the link, with a URL you can follow
bk sales prospect show 12
```

Step 4 is the half that makes this worth doing. `prospect show` prints every
link touching the prospect, each with an **absolute URL into the deployment that
owns the far end** — so the relationship is something you can act on, not just
something stored. A far end sitting in its own recycle bin is shown and flagged
rather than hidden: something you are blocked on being deleted is exactly what
you need to be told.

## One login, one binary

You do not authenticate twice. One token reaches every app you have been granted,
and each app's commands go to that app's own deployment automatically — you never
pass a URL. `bk app list` shows which apps your token can reach, and
`bk guide platform/apps` explains which commands go where and why the spelling
tells you.

## Activity spans apps too

```bash
bk activity --since 7d
```

Bare, like `search` and `link`, and for the same reason: a feed that stopped at
one app's boundary would not be a feed of your week. Each entry is tagged with
the app that produced it.

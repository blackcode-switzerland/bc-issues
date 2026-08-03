# Files, images & embedding

## What is accepted

**Any file type except the ones listed in `media.blocked_mime_types` in
`bk meta`** (currently SVG, blocked because it can carry script). Do not assume
"any type" — check `bk meta`; the block list can change without a CLI release.

Maximum size: `limits.upload_max_bytes` in `bk meta`. Uploading a larger file
fails before any bytes are sent.

## How an uploaded file renders

Once an uploaded url is referenced in a rich-text body, the server upgrades it
automatically. The rule set is served live as `media` in `bk meta`:

| MIME | Renders as |
|---|---|
| `image/*` | inline image preview |
| `video/*` | inline `<video>` player |
| `audio/*` | inline `<audio>` player |
| `application/pdf` | card with **View** + **Download** |
| everything else | download card |

Only urls from **our** upload pipeline are upgraded. An external url stays a
plain link — so "embed this video" always means "upload it first".

## The three ways to embed

**1. One step (easiest).** The `--file` flag uploads and embeds in one call:

```bash
bk issue create --title "Crash report" --file ./screenshot.png
bk issue comment 42 --file ./trace.log
bk project create --name "Launch" --file ./deck.pdf
```

**2. Reference a local path inside the body.** The CLI finds local paths in your
Markdown, uploads them, and rewrites the reference:

```bash
bk issue edit 42 --description '![](./screenshot.png)'
```

**3. Upload first, embed by url.**

```bash
url=$(bk upload ./clip.mp4 --json | jq -r '.url')
bk issue comment 42 --body "[clip.mp4]($url)"
```

Write `![name](url)` for an image and `[name](url)` for anything else. The server
promotes a non-image written with image syntax to the right player anyway.

## Paths with spaces or parentheses

Wrap the target in **angle brackets** or Markdown stops the link at the first
`)`:

```
[](</abs/my file (2).mp4>)
```

## Attachments are a different thing

`bk issue attach <id> --file ./x` adds to the issue's **attachments list** (the
sidebar). It does not put the file in the body. Use `--file` on
`create`/`edit`/`comment` for in-body embedding.

```bash
bk issue attach 42 --file ./log.txt
bk issue attachments 42
bk issue detach 42 <attachment-id>
```

Related commands: `bk upload`, `bk issue attach|detach|attachments`, `bk issue|task|project create --file`, `bk meta`

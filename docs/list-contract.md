# Writing a list script for Orbit

Orbit (a local board for Claude Code sessions) can show a list on an island — todos, roadmap, bugs, CRM tasks, anything. The list comes from a **script in your repo**: Orbit runs it and draws what it prints. Your job is to write that script. This page is everything you need; it is contract version 1 ([ADR-0036](adr/0036-list-script-contract.md) has the reasoning).

## How Orbit runs the script

- The user configures a **shell command** in Orbit ("Pin list …"), e.g. `./scripts/orbit-todos.sh`. It runs through `/bin/sh -c`, so arguments and pipes work.
- Working directory: the island's folder (usually the repo root).
- Environment: the user's, plus `ORBIT_LIST_VERSION=1`.
- **stdout:** exactly one JSON document (below). Nothing else on stdout.
- **stderr:** logs only; Orbit ignores it.
- **Exit code** 0 on success. Anything else is a failure.
- **Timeout:** 30 s. Orbit refreshes every 1–60 minutes or on demand; keep it fast.
- On failure Orbit keeps showing the last good list, marked as stale.
- Orbit only reads. Never write anything back to the source from this script.

## The document

```json
{
  "version": 1,
  "title": "Roadmap",
  "summary": { "text": "2 blockiert", "tone": "warn" },
  "sections": [
    { "id": "now", "title": "Now" },
    { "id": "next", "title": "Next" },
    { "id": "later", "title": "Later", "collapsed": true }
  ],
  "items": [
    {
      "id": "gh-412",
      "title": "Lists per island",
      "section": "now",
      "state": "active",
      "stateLabel": "In Arbeit",
      "ref": "#412",
      "url": "https://github.com/acme/app/issues/412",
      "note": "Short plain text, shown in the detail panel.",
      "badges": [{ "text": "Epic", "tone": "accent" }, { "text": "@alex" }],
      "children": [
        { "id": "gh-413", "title": "Contract v1", "state": "done" },
        { "id": "gh-414", "title": "Board view", "state": "blocked", "note": "Waits for design." }
      ]
    },
    { "id": "gh-420", "title": "Fix export", "section": "next" }
  ]
}
```

### Top level

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | always `1` |
| `items` | yes | top-level items, **in the order you want them shown** |
| `title` | no | default name of the list in Orbit |
| `sections` | no | ordered groups `{ id, title, collapsed? }`. Without it, all items form one untitled group. `collapsed: true` folds the group by default (good for "Later"). |
| `summary` | no | `{ text, tone? }` — one line Orbit shows when zoomed out, instead of its own counts. Use it when you can say something better than "Now 2 · Next 5". |
| `error` | no | see "Failures" |

### Item

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | string or number, **stable across runs** (use the issue number, record id …). Orbit uses it to mark what changed. Unique in the whole document. |
| `title` | yes | plain text, no Markdown or HTML |
| `section` | no | id of a section; top-level items only, children inherit it. Unknown ids land in a group "Other" at the end. |
| `state` | no | `open` (default) · `active` · `blocked` · `done` — picks the dot colour |
| `stateLabel` | no | your own word for the state, e.g. "In Review", "Angebot raus" |
| `ref` | no | short handle the user can cite in text, in the source's own notation: `#412`, `acme/app#412`, `ORB-12`. Shown before the title; a click copies it. Up to 40 characters. |
| `url` | no | `http(s)` link to the item in its source; the title becomes a link |
| `note` | no | short plain text, shown in the detail panel |
| `badges` | no | up to 8 `{ text, tone? }`: labels, assignee, due date, amount — anything |
| `children` | no | nested items, same shape. Orbit shows two levels on the board and the whole tree in the panel. |

`tone` is one of `neutral` (default) · `accent` · `good` · `warn` · `bad`.

### What Orbit does with it

- Keeps **your order** everywhere — sections, items, children. Sort in the script.
- Marks `blocked` items red and counts them, but never moves them.
- Hides `done` items in the compact views and counts them as progress (`2/4` on a parent). Whether you include done items at all is your choice; a few recent ones are useful, hundreds are noise.
- Ignores unknown fields and skips items without `id` or `title` — the rest still shows.
- Caps: 1000 items in total, texts are cut (title 300 characters, badge and ref 40).

## Failures

When the source cannot be read, print a message for the user **in English** and exit non-zero:

```json
{ "version": 1, "error": "gh is not logged in. Run `gh auth login`." }
```

Orbit shows the text as it is. Without it the user only sees "The script exited with code 1."

## Tips

- Shell plus `jq` is usually enough. Example for GitHub Issues with labels `now`/`next`/`later`:

  ```sh
  #!/bin/sh
  set -e
  gh issue list --state open --limit 200 --json number,title,url,labels,assignees 2>/dev/null | jq '{
    version: 1,
    title: "Issues",
    sections: [{id:"now",title:"Now"},{id:"next",title:"Next"},{id:"later",title:"Later",collapsed:true}],
    items: map({
      id: (.number|tostring), ref: ("#" + (.number|tostring)), title, url,
      section: ([.labels[].name | select(. == "now" or . == "next" or . == "later")][0] // "later"),
      state: (if any(.labels[]; .name == "blocked") then "blocked" else "open" end),
      badges: [.assignees[] | {text: ("@" + .login)}]
    })
  }' || { echo '{"version":1,"error":"Couldn't read the issues."}'; exit 1; }
  ```

- Make the script executable (`chmod +x`) and run it yourself before pinning: `./scripts/orbit-todos.sh | jq .`
- Credentials come from the user's own tools (`gh`, CLI logins, env files). Never put secrets into the output.
- A reference with every field: `scripts/orbit-list-demo.sh` in the Orbit repo.

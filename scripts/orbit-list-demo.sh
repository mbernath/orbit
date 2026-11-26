#!/bin/sh
# Demo list script for ADR-0036: prints dummy data in the list contract v1.
# Usage: configure "scripts/orbit-list-demo.sh" as a list node's command.
# Pass "error" as first argument to emit a user-facing failure instead.

if [ "$1" = "error" ]; then
  printf '%s\n' '{"version":1,"error":"Demo error: source not reachable"}'
  exit 1
fi

cat <<'JSON'
{
  "version": 1,
  "title": "Roadmap (demo)",
  "sections": [
    { "id": "now", "title": "Now" },
    { "id": "next", "title": "Next" },
    { "id": "later", "title": "Later", "collapsed": true }
  ],
  "items": [
    {
      "id": "demo-1",
      "title": "Lists per island",
      "section": "now",
      "state": "active",
      "stateLabel": "In progress",
      "ref": "#1",
      "url": "https://example.com/issues/1",
      "badges": [{ "text": "Epic", "tone": "accent" }, { "text": "Alex" }],
      "children": [
        { "id": "demo-2", "title": "Settle contract v1", "state": "done" },
        { "id": "demo-3", "title": "Demo script", "state": "done" },
        { "id": "demo-4", "title": "Lists source and entity", "state": "active" },
        { "id": "demo-5", "ref": "#5", "title": "View per depth", "state": "blocked",
          "stateLabel": "Waiting", "note": "Waiting for the design of depths 0–3." }
      ]
    },
    {
      "id": "demo-6",
      "title": "Notice for an outdated hook install",
      "section": "now",
      "state": "open",
      "badges": [{ "text": "Bug", "tone": "bad" }]
    },
    {
      "id": "demo-7",
      "title": "Agents read lists",
      "section": "next",
      "badges": [{ "text": "Idea" }],
      "children": [
        { "id": "demo-8", "title": "Trigger: new item in a section" },
        { "id": "demo-9", "title": "List as context for a session" }
      ]
    },
    {
      "id": "demo-10",
      "title": "Start a session from an item",
      "section": "next",
      "badges": [{ "text": "due Dec 12", "tone": "warn" }]
    },
    { "id": "demo-11", "title": "Push instead of interval", "section": "later" },
    { "id": "demo-12", "title": "Actions per item (write)", "section": "later" },
    { "id": "demo-13", "title": "Linux variant of the folder picker", "section": "later",
      "badges": [{ "text": "small", "tone": "good" }] }
  ]
}
JSON

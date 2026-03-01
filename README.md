# plsm-GD

Project-Level Session Memory for Google Docs & related.

---

## Problem

When working across multiple Google Docs, Sheets, and Slides within a single project, every browser restart forces a manual rebuild:

- reopen each file
- find the right tabs
- reassemble the working context

This repetition breaks flow.

## Goal

Restore working context instantly:

Scope a project once.
Reopen everything relevant in one action.

## Concept

Instead of remembering individual files, remember project-level context.

- Group Docs/Sheets/Slides into named project sets
- Opening a project automatically restores its full working set
- All tabs reopen together inside a single Chrome tab group

One click -> full context restored.

## Demo

[insert screen recording]

## Architecture

```text
plsm-GD/
├── README.md
└── docs-session-memory/
    ├── manifest.json
    ├── service_worker.js
    ├── content_script.js
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.js
```

- `manifest.json`: MV3 extension config, permissions, host permissions, OAuth scope, and script wiring.
- `service_worker.js`: state + restore core (`chrome.storage.local`, tab-group open/auto-open/sync logic).
- `content_script.js`: Docs/Drive DOM selection extraction + restore confirm prompt.
- `popup/*`: extension UI for create/open/manage (bubble view + list view).

## Features

- Opening a file directly from Docs/Drive auto-restores all saved group(s) that contain that file.
- Opening a group directly from the extension restores only that selected group.
- Same file can exist in multiple groups without cross-group merge side effects.
- Restores reuse/merge by tab-group title to keep one canonical Chrome group per saved group.
- Large auto-restore flows require confirmation before opening many tabs (combined threshold gate).
- Drive folder adds are expanded recursively into supported editor files before storage/restore.
- Group deletion sync is behavior-aware:
- `Manage > Delete Group` always deletes saved group.
- Chrome `Ungroup` can delete matching saved group.
- Close-style tab loss does not incorrectly delete saved groups.

## Installation

Chrome Extension link: 

OR locally

1. Clone this repo.
2. Open `docs-session-memory/manifest.json`.
3. Replace `oauth2.client_id` with your OAuth client ID.
4. In Chrome, open `chrome://extensions`.
5. Enable Developer mode.
6. Load unpacked extension from `docs-session-memory/`.

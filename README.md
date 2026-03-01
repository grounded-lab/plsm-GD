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

`docs-session-memory/`

- `manifest.json`
- MV3 extension config, permissions, host permissions, OAuth scope, and script wiring.
- `service_worker.js`
- Source of truth for group state in `chrome.storage.local`.
- Normalizes file identity, expands Drive folders, restores tab groups, and handles auto-open.
- Contains tab-group lifecycle rules (including ungroup/delete sync behavior).
- `content_script.js`
- Runs on Docs/Drive pages.
- Extracts selected items from page DOM and returns normalized ids/types.
- Handles tab-open confirmation prompts for large restores.
- `popup/`
- `popup.html`, `popup.css`, `popup.js`.
- UI for creating/opening/managing groups (bubble view + list view), rename/delete/remove/add-by-link.

Runtime data model (in storage):

- `dsm_groups.groups[group_name] = { items[], created_at, updated_at, last_opened_at? }`
- `items[]` are normalized file refs (doc/sheet/slide + id + optional title).

Primary flows:

1. Add flow: popup -> content script selection/current URL -> service worker normalize + save.
2. Open flow (manual): popup `OPEN_GROUP` -> service worker opens/reuses Chrome tab group.
3. Open flow (automatic): user opens file directly in Docs/Drive -> service worker finds matching groups and restores.
4. Manage flow: popup actions (`RENAME_GROUP`, `DELETE_GROUP`, `REMOVE_ITEM_FROM_GROUP`, `ADD_LINK_TO_GROUP`) -> service worker updates storage.

## Features

- Create/open named groups of Google Docs, Sheets, and Slides files.
- Add items by:
- current editor tab
- selected files from Docs Home / Drive
- direct link
- Drive folder (recursive expansion to supported file types)
- Restore groups into Chrome tab groups with duplicate prevention/reuse by group title.
- Auto-restore from direct file open:
- if file belongs to multiple groups, restore all matching groups
- if total restore size is large, show confirm prompt before opening
- Manage groups in extension UI:
- rename group
- delete group
- remove item from group
- add item by link
- Group list ordering by recency (`last_opened_at` then `updated_at`).
- Bubble view + list view popup modes.
- Chrome tab-group sync:
- renaming a Chrome tab group updates matching saved group name
- ungroup-style removal can delete matching saved group (with close-vs-ungroup guard logic)

## Installation

Chrome Extension link: 

OR locally

1. Clone this repo.
2. Open `docs-session-memory/manifest.json`.
3. Replace `oauth2.client_id` with your OAuth client ID.
4. In Chrome, open `chrome://extensions`.
5. Enable Developer mode.
6. Load unpacked extension from `docs-session-memory/`.

# plsm-GD

Project-Level Session Memory for Google Docs

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

## Core Concept

Instead of remembering individual files, remember project-level context.

- Group Docs/Sheets/Slides into named project sets
- Opening a project automatically restores its full working set
- All tabs reopen together inside a single Chrome tab group

One click -> full context restored.

## Features

- Add the current tab Google Doc/Sheet/Slide to a named group
- Add selected files from Google Drive or Docs Home
- Add entire Drive folders as dynamic groups
- Create new groups or update existing ones
- Prevent duplicate tabs on restore
- Open projects as organized Chrome tab groups

## Installation

Chrome Extension.  

Link: 


--------------------------------------
- Saves named groups of Google Docs/Sheets/Slides files.
- Restores a group as a Chrome tab group.
- Auto-opens matching groups when you directly open a file from Docs/Drive.
- Supports adding files by selection, current tab, or link.

## Current Features

- Group lifecycle:
- Create group
- Rename group
- Delete group
- Group items:
- Add current editor tab (Docs/Sheets/Slides)
- Add selected items from Google Drive or Docs Home
- Add by link (Docs/Sheets/Slides/Drive folder)
- Remove individual file from group (in extension only)
- Open behavior:
- Open a group manually from popup
- Any file can belong to multiple groups
- Direct file open can restore all groups containing that file
- Singleton by group name: prevents multiple simultaneous same-name group instances
- UI:
- Bubble view (floating colorful circles)
- List view (sorted by most recently opened)
- Manage panel per group
- `+ create new` action
- Folder support:
- Adding a Drive folder expands recursively and stores supported editor files
- Non-editor files are not stored as group items

## Permissions / APIs

From `manifest.json`:

- Permissions: `tabs`, `storage`, `tabGroups`, `activeTab`, `scripting`, `identity`
- Host permissions:
- `https://docs.google.com/*`
- `https://drive.google.com/*`
- `https://www.googleapis.com/*`
- OAuth scope: `https://www.googleapis.com/auth/drive.readonly`

## Setup

1. Clone this repo.
2. Open `docs-session-memory/manifest.json`.
3. Replace `oauth2.client_id` with your OAuth client ID.
4. In Chrome, open `chrome://extensions`.
5. Enable Developer mode.
6. Load unpacked extension from `docs-session-memory/`.

## Notes

- Group edits (rename/delete/remove item/add by link) are done in the extension UI.
- Closing a tab in a Chrome tab group does not delete it from stored group data.
- Auto-open behavior uses URL parsing + tab event listeners; if Google changes DOM/URL behavior, selectors/parsing may need updates.

# plsm-GD

Project-Level Session Memory for Google Docs and related.

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

## Demo

[insert screen recording]

## Features

- Add the current tab Google Doc/Sheet/Slide to a named group
- Add selected files from Google Drive or Docs Home
- Add entire Drive folders as dynamic groups
- Create new groups or update existing ones
- Prevent duplicate tabs on restore
- Open projects as organized Chrome tab groups

## Installation

Chrome Extension link: 

OR locally

1. Clone this repo.
2. Open `docs-session-memory/manifest.json`.
3. Replace `oauth2.client_id` with your OAuth client ID.
4. In Chrome, open `chrome://extensions`.
5. Enable Developer mode.
6. Load unpacked extension from `docs-session-memory/`.


# plsm-GD

Project-Level Session Memory for Google Docs

## Target

Since Google Docs/Sheets/Slides workflows are inherently multi-tab and long-running, there are several structural frictions that persist:

- **no project-level session memory**  

    After every browser restart or accidental closure, tabs and tab groups are lost and the working set must be rebuilt manually. 
    Chrome grouping/pinning is session-bound and binary: either the context is already open, or it is gone. 

- **high-tab cognitive load**  

    In large or multi-project scopes (tens to hundreds of open tabs), users cannot reliably determine whether a file is already open, which project it belongs to, or which other tabs also form its working context.

- **flattened tab model vs. contextual workflows**  

    In practice, people typically focus on one primary project at a time while keeping secondary or potentially useful tabs open “just in case.” Many tabs are contextually linked (one anchor -> multiple related tabs), but Chrome treats all tabs as flat and independent.  
    
    Without entry-point restore semantics, users must keep entire working sets open instead of reopening a single primary tab and having its full project context restored automatically — further amplifying tab sprawl and cognitive load.

## Concept

**core:**
- Restore the right working set quickly from *any* included tab entry point.

    - Opening a file directly from Docs/Drive auto-restores all saved group(s) that contain that file. 

    - [insert screen recording (1 file -> 1 group)]  | [insert screen recording (1 file -> multiple groups)]. 
    
- Opening a group directly from the extension restores only the selected group, even if it shares tabs with other saved groups.

    - [insert screen recording]

**some other:**
- Same file can exist in multiple groups without cross-group merge side effects.
- Restores reuse/merge by tab-group title to keep one canonical Chrome group per saved group.
- Large auto-restore flows require confirmation before opening many tabs (combined threshold gate).
- Drive folder adds are expanded recursively into supported editor files before storage/restore.
- Support dynamic up-to-date grouping if the Drive folder changes.
- Group deletion sync is behavior-aware:
    - `Manage > Delete Group` always deletes saved group.
    - Chrome `Ungroup` can delete matching saved group.
    - Close-style tab loss does not incorrectly delete saved groups.

## Architecture

```text
plsm-GD/
├── .gitignore
├── LICENSE
├── README.md
├── privacy.md
└── docs-session-memory/
    ├── icons/icon.png
    ├── manifest.json
    ├── service_worker.js
    ├── content_script.js
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.js
```

- `service_worker.js`: state + restore core.
- `content_script.js`: Docs/Drive DOM selection extraction.
- `popup/*`: extension UI for create/open/manage/view.

## Installation

Chrome Extension link: 

OR locally

1. Clone this repo.
2. Open `docs-session-memory/manifest.json`.
3. Replace `oauth2.client_id` with your OAuth client ID.
4. In Chrome, open `chrome://extensions`.
5. Enable Developer mode.
6. Load unpacked extension from `docs-session-memory/`.

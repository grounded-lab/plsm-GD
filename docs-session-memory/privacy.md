# Privacy Policy for Docs Session Memory

**Last updated:** March 1, 2026

Docs Session Memory ("the extension") helps users save and restore Google Docs/Sheets/Slides working groups in Chrome.

## Data We Collect

The extension processes only the data needed to provide its core functionality:

- Group metadata created by the user (for example, group names)
- Google Docs/Sheets/Slides and Drive item identifiers (file/folder IDs)
- Item titles/names used to display saved groups
- Tab/group state metadata needed to restore sessions (for example, timestamps and group mappings)
- OAuth access token obtained through Chrome Identity API to call Google Drive API (used in-memory at runtime)

## Data We Do Not Collect

The extension is not designed to collect:

- Health information
- Financial/payment information
- Passwords, PINs, or security questions
- Personal communications content (email, chat, messages)
- Precise location data

## How Data Is Used

Data is used only to:

- Save and manage user-defined groups
- Restore related Docs/Drive tabs and tab groups
- Expand Drive folders into supported Google editor files
- Resolve file names for better display in the extension UI

## Storage and Retention

- Extension data is stored locally using `chrome.storage.local` in the user's browser profile.
- OAuth tokens are managed by Chrome and are not intentionally persisted by the extension.
- Data remains until the user deletes groups, clears extension data, or uninstalls the extension.

## Data Sharing

- We do **not** sell user data.
- We do **not** share user data with third parties for advertising or marketing.
- Data is sent only to Google services required for functionality (for example, Google Drive API requests initiated by the user-authorized extension).

## Remote Code

The extension does not load or execute remote JavaScript or WebAssembly. All executable code is packaged with the extension.

## Security

We use Chrome extension platform controls and least-privilege permissions to limit access to only what is needed for core functionality.

## Children's Privacy

The extension is not directed to children under 13.

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected by updating the "Last updated" date above.

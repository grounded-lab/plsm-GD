/**
* handles::
* storing groups
* parsing docIDs
* opening groups
* loop prevention
* tab grouping
* tab events
*/

const STORAGE_KEY = "dsm_groups";

async function get_auth_token() {
    return await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(chrome.runtime.lastError || new Error("no token"))
            } else {
                resolve(token);
            }
        });
    });
}

/**
 * Normalized item:
 * {
 *   id: string,
 *   type: "doc" | "sheet" | "slide" | "drive_file" | "drive_folder" | "unknown",
 * }
 * Stored data:
 * {
 *   groups: {
 *     [group_name]: {
 *       items: Array[normalized_item],
 *       created_at: number,
 *       updated_at: number,
 *     }
 *   }
 * }
 */

async function load_state() {
    const out = await chrome.storage.local.get([STORAGE_KEY]);
    return out[STORAGE_KEY] ?? { groups: {} }; 
}

async function save_state(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function now() {
    return Date.now()
}

/**
 * extract normalized ID + type from known google urls.
 * note: store ids not urls.
 */
function parse_normalized_item(url) {
    try {
        const u = new URL(url);

        // docs page
        if (u.hostname === "docs.google.com") {
            const p = u.pathname;

            // https://docs.google.com/document/d/<ID>/edit
            const doc_match = p.match(/\/document\/d\/([^/]+)/);
            if (doc_match) return { id: doc_match[1], type: "doc" };

            // https://docs.google.com/spreadsheets/d/<ID>/edit
            const sheet_match = p.match(/\/spreadsheets\/d\/([^/]+)/);
            if (sheet_match) return { id: sheet_match[1], type: "sheet" };

            // https://docs.google.com/presentation/d/<ID>/edit
            const slide_match = p.match(/\/presentation\/d\/([^/]+)/);
            if (slide_match) return { id: slide_match[1], type: "slide" };

            return null;
        }

        // drive page
        if (u.hostname === "drive.google.com") {
            const p = u.pathname;

            // https://drive.google.com/file/d/<ID>/view
            const file_match = p.match(/\/file\/d\/([^/]+)/);
            if (file_match) return { id: file_match[1], type: "drive_file" };

            // https://drive.google.com/drive/folders/<ID>
            const folder_match = p.match(/\/drive\/folders\/([^/]+)/);
            if (folder_match) return { id: folder_match[1], type: "drive_folder" };

            return null;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * reconstruct an openable url from normalized item.
 * note: for doc/drive file, we default open in Docs/Drive respectively.
 */
function build_url_from_item(item) {
    switch (item.type)  {
        case "doc":
            return 'https://docs.google.com/document/d/${item.id}/edit';
        case "sheet":
            return 'https://docs.google.com/spreadsheets/d/${item.id}/edit';
        case "slide":
            return 'https://docs.google.com/presentation/d/${item.id}/edit';
        case "drive_file":
            return 'https://drive.google.com/file/d/${item.id}/view';
        case "drive_folder":
            return 'https://drive.google.com/drive/folders/${item.id}';
        default:
            return null;
    }
}

/**
 * add items to group by (type,id).
 */
async function add_items_to_group(group_name, items) {
    if (!group_name || !Array.isArray(items) || items.length === 0) return;

    const state = await load_state();
    const groups = state.groups ?? {};

    // create new group
    if (!groups[group_name]) {
        groups[group_name] = {
            items: [],
            created_at: now(),
            updated_at: now(),
        };
    }

    // add to existing group
    const existing = new Set(groups[group_name].items.map((x) => `${x.type}:${x.id}`));
    for (const it of items) {
        if (!it?.id || !it?.type) continue;
        const key = `${it.type}:${it.id}`;
        if (!existing.has(key)) {
            groups[group_name].items.push({ id: it.id, type: it.type });
            existing.add(key);
        }
    }

    groups[group_name].updated_at = now();
    state.groups = groups;
    await save_state(state);
}

async function list_groups() {
    const state = await load_state();
    return Object.keys(state.groups ?? {}).sort();
}

async function get_group(group_name) {
    const state = await load_state();
    return state.groups?.[group_name] ?? null;
}

/**
 * prevents loop.
 * note: don't open a url if an already-open tab maps to same normalized item.
 */
async function get_opened_keys() {
    const tabs = await chrome.tabs.query({});
    const keys = new Set();
    for (const t of tabs) {
        if (!t.url) continue;
        const item = parse_normalized_item(t.url);
        if (item) keys.add(`${item.type}:${item.id}`);
    }
    return keys;
}

/**
 * open missing items only, then update group tab.
 */
async function open_group(group_name) {
    const group = await get_group(group_name);
    if (!group || !Array.isArray(group.items) || group.items.length === 0) return;

    let items_to_open = await expand_folder(group.items);
    items_to_open = dedup_items(items_to_open);

    const open_keys = await get_opened_keys();
    const created_tabIDs = [];

    for (const item of items_to_open) {
        const key = `${item.type}:${item.id}`;
        if (open_keys.has(key)) continue;

        const url = build_url_from_item(item);
        if (!url) continue;

        const tab = await chrome.tabs.create({ url, active: false });
        created_tabIDs.push(tab.id);
    }

    // tab grouping
    if (created_tabIDs.length > 0) {
        try {
            const group_id = await chrome.tabGroups.group({ tabIDs: created_tabIDs });
            await chrome.tabGroups.update(group_id, { title: group_name, collapsed: false });
        } catch (e) {
            console.warn("tabGroups error:", e);
        }
    }
}

/**
 * get children of drive folder.
 */
async function get_folder_children(folder_id) {
    const token = await get_auth_token();

    const q = encodeURIComponent(`'${folder_id}' in parents and trashed=false`);
    const fields = encodeURIComponent("next_page_token, files(id, mimeType, name)");

    let page_token = "";
    const out = [];

    while (true) {
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}` + (page_token ? `&pageToken=${encodeURIComponent(page_token)}` : "");
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
        if (!resp.ok) throw new Error(`drive API error: ${resp.status}`);
        const data = await resp.json();
        const files = data.files ?? [];

        for (const f of files) {
            /**
             * map mimeType to normalized type.
             * note: docs editors have special mimeTypes:
             * - application/vnd.google-apps.document
             * - application/vnd.google-apps.spreadsheet
             * - application/vnd.google-apps.presentation
             */
            if (f.mimeType === "application/vnd.google-apps.document") 
                out.push({ id: f.id, type: "doc" });
            else if (f.mimeType === "application/vnd.google-apps.spreadsheet")
                out.push({ id: f.id, type: "sheet" });
            else if (f.mimeType === "application/vnd.google-apps.presentation")
                out.push({ id: f.id, type: "slide" });
            else if (f.mimeType === "application/vnd.google-apps.folder") {
                out.push({ id: f.id, type: "drive_folder" });
            } else out.push({ id: f.id, type: "drive_file" });
        }

        if (!data.next_page_token) break;
        page_token = data.next_page_token;
    }

    return out;
}

/**
 * expands drive_folder items into their children.
 */
async function expand_folder(items) {
    const out = []

    for (const item of items) {
        if (item.type !== "drive_folder") {
            out.push(item);
            continue;
        }

        try {
            const children = await get_folder_children(item.id);
            out.push(...children);
        } catch (e) {
            console.warn("failed to expand folder:", item.id, e);
            out.push(item); // fallback behavior: open the folder itself.
        }
    }

    return out;
}

/**
 * de-dupe items.
 * note: important if folder contains duplicates or overlaps.
 */
function unique_by_key(items) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

/**
 * light listener for auto group feature.
 * note: optional for v1 to avoid accidental loops.
 */
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, _tab) => {
  if (changeInfo.status === "complete") {
    // intentionally empty for v1.
    // later: could auto-detect if opened doc belongs to a group, etc.
  }
});

/**
 * message router.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        const type = message?.type;

        if (type === "LIST_GROUPS") {
            const groups = await list_groups();
            sendResponse({ ok: true, groups });
            return;
        }

        if (type === "CREATE_GROUP") {
            const name = (message?.group_name ?? "").trim();
            if (!name) {
                sendResponse({ ok: false, error: "missing group_name" });
                return;
            }
            // create empty group
            const state = await load_state();
            state.groups = state.groups ?? {};
            if (!state.groups[name]) state.groups[name] = { items: [], created_at: now(), updated_at: now() };
            await save_state(state);
            sendResponse({ ok: true });
            return;
        }

        if (type === "ADD_ITEMS_TO_GROUP") {
            const name = (message?.group_name ?? "").trim();
            const items = message?.items ?? [];
            await add_items_to_group(name, items);
            sendResponse({ ok: true });
            return;
        }

        if (type === "ADD_CURR_URL_TO_GROUP") {
            const name = (message?.group_name ?? "").trim();
            const url = message?.url ?? "";
            const item = parse_normalized_item(url);
            if (!item) {
                sendResponse({ ok: false, error: "could not parse id from url "});
                return;
            }
            await add_items_to_group(name, [item]);
            sendResponse({ ok: true });
            return;
        }

        if (type === "OPEN_GROUP") {
            const name = (message?.group_name ?? "").trim();
            await open_group(name);
            sendResponse({ ok: true });
            return;
        }


        sendResponse({ ok: false, error: `unknown message type: ${type}`});
    })();

    return true; // keep channel open for async response.
})
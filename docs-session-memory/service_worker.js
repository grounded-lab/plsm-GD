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
const STORABLE_ITEM_TYPES = new Set(["doc", "sheet", "slide"]);

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

let state_write_queue = Promise.resolve();

function with_state_write(mutator) {
    const run = state_write_queue.then(async () => {
        const state = await load_state();
        const next = (await mutator(state)) ?? state;
        await save_state(next);
    });
    // keep queue alive even if one write fails
    state_write_queue = run.catch(() => {});
    return run;
}

function now() {
    return Date.now()
}

function canonical_item_key(item) {
    if (!item?.id || !item?.type) return null;
    // treat editor files and generic Drive files as the same resource by file id.
    if (item.type === "doc" || item.type === "sheet" || item.type === "slide" || item.type === "drive_file") {
        return `file:${item.id}`;
    }
    return `${item.type}:${item.id}`;
}

function sanitize_storable_items(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
        const id = typeof it?.id === "string" ? it.id.trim() : "";
        const type = typeof it?.type === "string" ? it.type : "";
        if (!id || !STORABLE_ITEM_TYPES.has(type)) continue;
        const raw_title = typeof it?.title === "string" ? it.title : (typeof it?.name === "string" ? it.name : "");
        const title = raw_title.trim();
        out.push(title ? { id, type, title } : { id, type });
    }
    return out;
}

function clean_doc_title(raw) {
    const t = (raw ?? "").trim();
    if (!t) return "";
    return t
        .replace(/\s*-\s*Google Docs$/i, "")
        .replace(/\s*-\s*Google Sheets$/i, "")
        .replace(/\s*-\s*Google Slides$/i, "")
        .trim();
}

async function expand_items_for_storage(items) {
    const out = [];
    const seen_folders = new Set();
    const folder_queue = [];

    for (const it of items ?? []) {
        if (!it?.id || !it?.type) continue;
        if (it.type === "drive_folder") {
            folder_queue.push(it.id);
            continue;
        }
        out.push(it);
    }

    while (folder_queue.length > 0) {
        const folder_id = folder_queue.shift();
        if (!folder_id || seen_folders.has(folder_id)) continue;
        seen_folders.add(folder_id);

        const children = await get_folder_children(folder_id);
        for (const child of children) {
            if (!child?.id || !child?.type) continue;
            if (child.type === "drive_folder") {
                folder_queue.push(child.id);
                continue;
            }
            out.push(child);
        }
    }

    return out;
}

function parse_html_title(html) {
    const m = String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return "";
    return clean_doc_title(m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\""));
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
            // https://docs.google.com/document/u/0/d/<ID>/edit
            const doc_match = p.match(/\/document\/(?:u\/\d+\/)?d\/([^/]+)/);
            if (doc_match) return { id: doc_match[1], type: "doc" };

            // https://docs.google.com/spreadsheets/d/<ID>/edit
            // https://docs.google.com/spreadsheets/u/0/d/<ID>/edit
            const sheet_match = p.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
            if (sheet_match) return { id: sheet_match[1], type: "sheet" };

            // https://docs.google.com/presentation/d/<ID>/edit
            // https://docs.google.com/presentation/u/0/d/<ID>/edit
            const slide_match = p.match(/\/presentation\/(?:u\/\d+\/)?d\/([^/]+)/);
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
            // https://drive.google.com/drive/u/0/folders/<ID>
            const folder_match = p.match(/\/drive\/(?:u\/\d+\/)?folders\/([^/]+)/);
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
            return `https://docs.google.com/document/d/${item.id}/edit`;
        case "sheet":
            return `https://docs.google.com/spreadsheets/d/${item.id}/edit`;
        case "slide":
            return `https://docs.google.com/presentation/d/${item.id}/edit`;
        case "drive_file":
            return `https://drive.google.com/file/d/${item.id}/view`;
        case "drive_folder":
            return `https://drive.google.com/drive/folders/${item.id}`;
        default:
            return null;
    }
}

/**
 * add items to group by (type,id).
 */
async function add_items_to_group(group_name, items) {
    if (!group_name || !Array.isArray(items) || items.length === 0) return 0;
    const storable_items = sanitize_storable_items(items);
    if (storable_items.length === 0) return 0;

    await with_state_write(async (state) => {
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
        const existing = new Set(
            groups[group_name].items.map((x) => canonical_item_key(x)).filter(Boolean)
        );
        for (const it of storable_items) {
            if (!it?.id || !it?.type) continue;
            const key = canonical_item_key(it);
            if (!existing.has(key)) {
                if (it.title) groups[group_name].items.push({ id: it.id, type: it.type, title: it.title });
                else groups[group_name].items.push({ id: it.id, type: it.type });
                existing.add(key);
            } else if (it.title) {
                const idx = groups[group_name].items.findIndex((x) => canonical_item_key(x) === key);
                if (idx >= 0 && !groups[group_name].items[idx]?.title) {
                    groups[group_name].items[idx] = { ...groups[group_name].items[idx], title: it.title };
                }
            }
        }

        groups[group_name].updated_at = now();
        state.groups = groups;
        return state;
    });

    return storable_items.length;
}

async function list_groups() {
    const state = await load_state();
    const groups = state.groups ?? {};
    return Object.entries(groups)
        .sort((a, b) => {
            const a_opened = Number(a[1]?.last_opened_at || 0);
            const b_opened = Number(b[1]?.last_opened_at || 0);
            if (a_opened !== b_opened) return b_opened - a_opened;

            const a_updated = Number(a[1]?.updated_at || 0);
            const b_updated = Number(b[1]?.updated_at || 0);
            if (a_updated !== b_updated) return b_updated - a_updated;

            return String(a[0]).localeCompare(String(b[0]));
        })
        .map(([name]) => name);
}

async function get_group(group_name) {
    const state = await load_state();
    return state.groups?.[group_name] ?? null;
}

async function add_item_names(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const name_by_key = new Map();
    for (const it of items) {
        const key = canonical_item_key(it);
        if (!key) continue;
        const from_stored = clean_doc_title(it?.title);
        if (from_stored) name_by_key.set(key, from_stored);
    }

    // Use currently open tab titles as a cheap, non-auth fallback.
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (!tab?.url || !tab?.title) continue;
            const parsed = parse_normalized_item(tab.url);
            const key = canonical_item_key(parsed);
            if (!key || name_by_key.has(key)) continue;
            const title = clean_doc_title(tab.title);
            if (title) name_by_key.set(key, title);
        }
    } catch {
        // ignore tab title lookup failures
    }

    const unresolved = items.filter((it) => {
        const key = canonical_item_key(it);
        return key && !name_by_key.has(key);
    });

    if (unresolved.length > 0) {
        let token = null;
        try {
            token = await get_auth_token();
        } catch {
            token = null;
        }

        if (token) {
            await Promise.all(unresolved.map(async (it) => {
                if (!it?.id) return;
                try {
                    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(it.id)}?fields=name`;
                    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (!resp.ok) return;
                    const data = await resp.json();
                    const key = canonical_item_key(it);
                    const title = clean_doc_title(data?.name ?? "");
                    if (key && title && !name_by_key.has(key)) {
                        name_by_key.set(key, title);
                    }
                } catch {
                    // ignore single-item lookup failures
                }
            }));
        }
    }

    const unresolved_after_api = items.filter((it) => {
        const key = canonical_item_key(it);
        return key && !name_by_key.has(key);
    });

    // Last fallback: fetch the editor page and parse its <title>.
    if (unresolved_after_api.length > 0) {
        await Promise.all(unresolved_after_api.map(async (it) => {
            const key = canonical_item_key(it);
            if (!key) return;
            try {
                const url = build_url_from_item(it);
                if (!url) return;
                const resp = await fetch(url, { credentials: "include" });
                if (!resp.ok) return;
                const html = await resp.text();
                const title = parse_html_title(html);
                if (title && !name_by_key.has(key)) {
                    name_by_key.set(key, title);
                }
            } catch {
                // ignore single-item lookup failures
            }
        }));
    }

    return items.map((it) => {
        const key = canonical_item_key(it);
        return { ...it, name: key ? (name_by_key.get(key) ?? null) : null };
    });
}

async function delete_group(group_name) {
    if (!group_name) return false;
    let deleted = false;
    await with_state_write(async (state) => {
        const groups = state.groups ?? {};
        if (groups[group_name]) {
            delete groups[group_name];
            deleted = true;
        }
        state.groups = groups;
        return state;
    });
    return deleted;
}

async function rename_group(old_name, new_name) {
    if (!old_name || !new_name) return { ok: false, error: "missing group name" };
    if (old_name === new_name) return { ok: true };

    let result = { ok: false, error: "group not found" };
    await with_state_write(async (state) => {
        const groups = state.groups ?? {};
        if (!groups[old_name]) {
            result = { ok: false, error: "group not found" };
            return state;
        }
        if (groups[new_name]) {
            result = { ok: false, error: "group name already exists" };
            return state;
        }

        const group = groups[old_name];
        delete groups[old_name];
        groups[new_name] = {
            ...group,
            updated_at: now(),
        };
        state.groups = groups;
        result = { ok: true };
        return state;
    });

    return result;
}

async function remove_item_from_group(group_name, item) {
    if (!group_name || !item?.id || !item?.type) return false;
    const target_key = canonical_item_key(item);
    if (!target_key) return false;

    let removed = false;
    await with_state_write(async (state) => {
        const groups = state.groups ?? {};
        const group = groups[group_name];
        if (!group || !Array.isArray(group.items)) {
            return state;
        }

        const next_items = group.items.filter((it) => canonical_item_key(it) !== target_key);
        if (next_items.length !== group.items.length) {
            group.items = next_items;
            group.updated_at = now();
            removed = true;
        }

        groups[group_name] = group;
        state.groups = groups;
        return state;
    });

    return removed;
}

/**
 * prevents loop.
 * note: don't open a url if an already-open tab maps to same normalized item.
 */
async function get_open_state(window_id = null) {
    const query = window_id == null ? {} : { windowId: window_id };
    const tabs = await chrome.tabs.query(query);
    const keys = new Set();
    const tab_ids_by_key = new Map();

    for (const t of tabs) {
        const effective_url = t.url || t.pendingUrl || "";
        if (!effective_url) continue;
        const item = parse_normalized_item(effective_url);
        const key = canonical_item_key(item);
        if (!key) continue;

        keys.add(key);
        const list = tab_ids_by_key.get(key) ?? [];
        if (typeof t.id === "number") list.push(t.id);
        tab_ids_by_key.set(key, list);
    }

    return { keys, tab_ids_by_key };
}

/**
 * open missing items only, then update group tab.
 */
async function open_group(group_name, source_tab_id = null, options = {}) {
    const singleton_group = options?.singleton_group ?? true;
    const group = await get_group(group_name);
    if (!group || !Array.isArray(group.items) || group.items.length === 0) return;

    await with_state_write(async (state) => {
        state.groups = state.groups ?? {};
        const g = state.groups[group_name];
        if (g) {
            g.last_opened_at = now();
            state.groups[group_name] = g;
        }
        return state;
    });

    let items_to_open = await expand_folder(group.items);
    items_to_open = unique_by_key(items_to_open);
    const group_keys = new Set(items_to_open.map((it) => canonical_item_key(it)).filter(Boolean));

    let target_window_id = null;
    let source_tab_id_to_group = null;
    let source_item_key_to_group = null;
    if (typeof source_tab_id === "number") {
        try {
            const source_tab = await chrome.tabs.get(source_tab_id);
            target_window_id = source_tab?.windowId ?? null;
            const source_item = parse_normalized_item(source_tab?.url ?? "");
            const source_key = canonical_item_key(source_item);
            if (source_key && group_keys.has(source_key) && STORABLE_ITEM_TYPES.has(source_item.type)) {
                source_tab_id_to_group = source_tab_id;
                source_item_key_to_group = source_key;
            }
        } catch {
            target_window_id = null;
        }
    }

    let existing_group_id = null;
    const existing_group_keys = new Set();
    const existing_group_tab_ids = [];

    if (singleton_group) {
        try {
            const existing_groups = await chrome.tabGroups.query({ title: group_name });
            if (existing_groups.length > 0) {
                // Keep one canonical group per name. Merge duplicates into the first.
                existing_group_id = existing_groups[0].id;
                for (const g of existing_groups) {
                    const tabs = await chrome.tabs.query({ groupId: g.id });
                    if (tabs.length > 0 && target_window_id == null) {
                        target_window_id = tabs[0].windowId ?? null;
                    }
                    const tab_ids = tabs.map((t) => t.id).filter((id) => typeof id === "number");
                    if (tab_ids.length > 0) {
                        if (g.id !== existing_group_id) {
                            await chrome.tabs.group({ groupId: existing_group_id, tabIds: tab_ids });
                        }
                        for (const t of tabs) {
                            const effective_url = t.url || t.pendingUrl || "";
                            const item = parse_normalized_item(effective_url);
                            const key = canonical_item_key(item);
                            if (key) existing_group_keys.add(key);
                            if (typeof t.id === "number") existing_group_tab_ids.push(t.id);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("tabGroups query/merge error:", e);
        }
    }

    if (target_window_id == null) {
        try {
            const [active_tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            target_window_id = active_tab?.windowId ?? null;
        } catch {
            target_window_id = null;
        }
    }

    const created_tabIDs = [];

    for (const item of items_to_open) {
        const key = canonical_item_key(item);
        if (source_item_key_to_group && key === source_item_key_to_group) continue;
        if (singleton_group && existing_group_keys.has(key)) continue;

        const url = build_url_from_item(item);
        if (!url) continue;

        const create_params = { url, active: false };
        if (typeof target_window_id === "number") {
            create_params.windowId = target_window_id;
        }
        const tab = await chrome.tabs.create(create_params);
        created_tabIDs.push(tab.id);
        if (typeof tab.id === "number") {
            // mark immediately so loading lifecycle events for this tab
            // do not trigger other group auto-opens.
            auto_open_suppressed_tabs.set(tab.id, now());
        }
    }

    // tab grouping
    const tab_ids_to_group = [...created_tabIDs].filter((id) => typeof id === "number");
    if (typeof source_tab_id_to_group === "number") {
        if (!existing_group_tab_ids.includes(source_tab_id_to_group)) {
            tab_ids_to_group.unshift(source_tab_id_to_group);
        }
    }

    if (existing_group_id != null) {
        if (tab_ids_to_group.length > 0) {
            try {
                const unique_tab_ids = [...new Set(tab_ids_to_group)];
                await chrome.tabs.group({ groupId: existing_group_id, tabIds: unique_tab_ids });
                await chrome.tabGroups.update(existing_group_id, { title: group_name, collapsed: false });
            } catch (e) {
                console.warn("tabGroups update/attach error:", e);
            }
        }
        return;
    }

    // Create/update group whenever we have at least one tab to group.
    // This also supports single-file groups opened directly from Docs Home,
    // where the source tab itself should become a one-tab Chrome group.
    if (tab_ids_to_group.length > 0) {
        try {
            const unique_tab_ids = [...new Set(tab_ids_to_group)];
            const group_id = await chrome.tabs.group({ tabIds: unique_tab_ids });
            await chrome.tabGroups.update(group_id, { title: group_name, collapsed: false });
        } catch (e) {
            console.warn("tabGroups error:", e);
        }
    }
}

async function find_groups_for_item(item) {
    const key = canonical_item_key(item);
    if (!key) return [];
    const state = await load_state();
    const groups = state.groups ?? {};
    const out = [];

    for (const [group_name, group] of Object.entries(groups)) {
        const items = Array.isArray(group?.items) ? group.items : [];
        if (items.some((it) => canonical_item_key(it) === key)) {
            out.push({
                name: group_name,
                updated_at: Number(group?.updated_at || 0),
            });
        }
    }

    return out;
}

/**
 * get children of drive folder.
 */
async function get_folder_children(folder_id) {
    const token = await get_auth_token();

    const q = encodeURIComponent(`'${folder_id}' in parents and trashed=false`);
    const fields = encodeURIComponent("nextPageToken, files(id, mimeType, name)");

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

        if (!data.nextPageToken) break;
        page_token = data.nextPageToken;
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
        const key = canonical_item_key(item);
        if (!key) continue;
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
const auto_open_recent = new Map();
const AUTO_OPEN_TTL_MS = 2500;
const auto_open_suppressed_tabs = new Map();
const AUTO_OPEN_SUPPRESS_TTL_MS = 12000;
let auto_open_paused_until = 0;
const AUTO_OPEN_PAUSE_MS = 3000;
let recent_tab_close_at = 0;
const AUTO_OPEN_AFTER_CLOSE_SUPPRESS_MS = 2000;
const AUTO_OPEN_CASCADE_GUARD_MS = 2000;

async function maybe_auto_open_from_url(tab_id, url) {
    if (!url) return;

    const ts = now();
    if (ts - recent_tab_close_at < AUTO_OPEN_AFTER_CLOSE_SUPPRESS_MS) return;
    if (ts < auto_open_paused_until) return;
    const item = parse_normalized_item(url);
    if (!item) return;

    const suppressed_at = auto_open_suppressed_tabs.get(tab_id) ?? 0;
    if (ts - suppressed_at < AUTO_OPEN_SUPPRESS_TTL_MS) {
        return;
    }
    if (suppressed_at) auto_open_suppressed_tabs.delete(tab_id);

    const key = canonical_item_key(item);
    if (!key) return;
    const last = auto_open_recent.get(key) ?? 0;
    if (ts - last < AUTO_OPEN_TTL_MS) return;
    auto_open_recent.set(key, ts);

    const groups = await find_groups_for_item(item);
    if (groups.length === 0) return;

    // Guard against recursive "second wave" auto-opens from tabs spawned by this restore.
    auto_open_paused_until = Math.max(auto_open_paused_until, now() + AUTO_OPEN_CASCADE_GUARD_MS);

    // if an item belongs to multiple groups, open all (most recently updated first).
    groups.sort((a, b) => b.updated_at - a.updated_at || a.name.localeCompare(b.name));
    for (let i = 0; i < groups.length; i += 1) {
        const g = groups[i];
        const source_for_group = i === 0 ? tab_id : null;
        await open_group(g.name, source_for_group, { singleton_group: true });
    }
}

chrome.tabs.onUpdated.addListener((tab_id, changeInfo, tab) => {
  const effective_url = changeInfo.url || tab?.url || tab?.pendingUrl || "";
  if (!effective_url) return;
  if (changeInfo.status !== "complete" && !changeInfo.url) return;

  maybe_auto_open_from_url(tab_id, effective_url).catch((e) => console.warn("auto open error:", e));

  // Docs/Drive navigations occasionally finalize URL shortly after "complete".
  // Re-check once to make direct open detection more reliable.
  if (changeInfo.status === "complete") {
    setTimeout(() => {
      chrome.tabs.get(tab_id, (latest_tab) => {
        if (chrome.runtime.lastError || !latest_tab) return;
        const latest_url = latest_tab.url || latest_tab.pendingUrl || "";
        if (!latest_url || latest_url === effective_url) return;
        maybe_auto_open_from_url(tab_id, latest_url).catch((e) => console.warn("auto open error:", e));
      });
    }, 180);
  }
});

chrome.tabs.onRemoved.addListener(() => {
  recent_tab_close_at = now();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    const url = tab?.url || tab?.pendingUrl || "";
    if (!url) return;
    // If user is already navigating inside a Chrome tab group, avoid "healing"
    // recently closed tabs by re-running auto-restore on each activation.
    if (typeof tab.groupId === "number" && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
    maybe_auto_open_from_url(tabId, url).catch((e) => console.warn("auto open error:", e));
  });
});

/**
 * message router.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        try {
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
                await with_state_write(async (state) => {
                    // create empty group
                    state.groups = state.groups ?? {};
                    if (!state.groups[name]) state.groups[name] = { items: [], created_at: now(), updated_at: now() };
                    return state;
                });
                sendResponse({ ok: true });
                return;
            }

            if (type === "GET_GROUP") {
                const name = (message?.group_name ?? "").trim();
                if (!name) {
                    sendResponse({ ok: false, error: "missing group_name" });
                    return;
                }
                const group = await get_group(name);
                if (!group) {
                    sendResponse({ ok: true, group: null });
                    return;
                }
                const items = await add_item_names(group.items ?? []);
                sendResponse({ ok: true, group: { ...group, items } });
                return;
            }

            if (type === "DELETE_GROUP") {
                const name = (message?.group_name ?? "").trim();
                if (!name) {
                    sendResponse({ ok: false, error: "missing group_name" });
                    return;
                }
                const deleted = await delete_group(name);
                sendResponse({ ok: deleted, error: deleted ? null : "group not found" });
                return;
            }

            if (type === "RENAME_GROUP") {
                const old_name = (message?.old_group_name ?? "").trim();
                const new_name = (message?.new_group_name ?? "").trim();
                if (!old_name || !new_name) {
                    sendResponse({ ok: false, error: "missing group name" });
                    return;
                }
                const out = await rename_group(old_name, new_name);
                sendResponse(out);
                return;
            }

            if (type === "ADD_ITEMS_TO_GROUP") {
                const name = (message?.group_name ?? "").trim();
                if (!name) {
                    sendResponse({ ok: false, error: "missing group_name" });
                    return;
                }

                const items = Array.isArray(message?.items) ? message.items : null;
                if (!items || items.length === 0) {
                    sendResponse({ ok: false, error: "missing items" });
                    return;
                }

                let resolved_items = items;
                if (items.some((it) => it?.type === "drive_folder")) {
                    try {
                        resolved_items = await expand_items_for_storage(items);
                    } catch (e) {
                        sendResponse({ ok: false, error: e?.message || "failed to expand drive folder" });
                        return;
                    }
                }

                const valid_items = sanitize_storable_items(resolved_items);
                if (valid_items.length === 0) {
                    sendResponse({ ok: false, error: "only Google Docs/Sheets/Slides items are supported" });
                    return;
                }

                await add_items_to_group(name, valid_items);
                sendResponse({ ok: true });
                return;
            }

            if (type === "ADD_CURR_URL_TO_GROUP") {
                const name = (message?.group_name ?? "").trim();
                const url = message?.url ?? "";
                const title = clean_doc_title(message?.title ?? "");
                const item = parse_normalized_item(url);
                if (!item) {
                    sendResponse({ ok: false, error: "could not parse id from url "});
                    return;
                }
                if (!STORABLE_ITEM_TYPES.has(item.type)) {
                    sendResponse({ ok: false, error: "only Google Docs/Sheets/Slides pages can be added" });
                    return;
                }
                const item_with_title = title ? { ...item, title } : item;
                await add_items_to_group(name, [item_with_title]);
                sendResponse({ ok: true });
                return;
            }

            if (type === "ADD_LINK_TO_GROUP") {
                const name = (message?.group_name ?? "").trim();
                const url = (message?.url ?? "").trim();
                if (!name) {
                    sendResponse({ ok: false, error: "missing group_name" });
                    return;
                }
                if (!url) {
                    sendResponse({ ok: false, error: "missing url" });
                    return;
                }

                const item = parse_normalized_item(url);
                if (!item) {
                    sendResponse({ ok: false, error: "unsupported or invalid link" });
                    return;
                }

                let resolved_items = [item];
                if (item.type === "drive_folder") {
                    try {
                        resolved_items = await expand_items_for_storage([item]);
                    } catch (e) {
                        sendResponse({ ok: false, error: e?.message || "failed to expand drive folder" });
                        return;
                    }
                }

                const valid_items = sanitize_storable_items(resolved_items);
                if (valid_items.length === 0) {
                    sendResponse({ ok: false, error: "link type is not storable in this extension" });
                    return;
                }

                await add_items_to_group(name, valid_items);
                sendResponse({ ok: true });
                return;
            }

            if (type === "OPEN_GROUP") {
                const name = (message?.group_name ?? "").trim();
                const source_tab_id = Number.isInteger(message?.source_tab_id) ? message.source_tab_id : null;
                auto_open_paused_until = now() + AUTO_OPEN_PAUSE_MS;
                await open_group(name, source_tab_id, { singleton_group: true });
                sendResponse({ ok: true });
                return;
            }

            if (type === "REMOVE_ITEM_FROM_GROUP") {
                const name = (message?.group_name ?? "").trim();
                const item = message?.item ?? null;
                if (!name) {
                    sendResponse({ ok: false, error: "missing group_name" });
                    return;
                }
                if (!item?.id || !item?.type) {
                    sendResponse({ ok: false, error: "missing item" });
                    return;
                }
                const removed = await remove_item_from_group(name, item);
                sendResponse({ ok: removed, error: removed ? null : "item not found in group" });
                return;
            }

            sendResponse({ ok: false, error: `unknown message type: ${type}`});
        } catch (e) {
            sendResponse({ ok: false, error: e?.message ?? String(e) });
        }
    })();

    return true; // keep channel open for async response.
})

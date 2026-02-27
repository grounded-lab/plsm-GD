/**
* handles::
* ask the active tab url
* if it's a doc page, "ADD_CURRENT_DOC"
* if it's drive/docs-home: send message "GET_SELECTED_ITEMS" to content script
*/

/**
 * send to service worker.
 */
async function send_to_sw(message) {
    return await chrome.runtime.sendMessage(message);
}

async function get_active_tab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
}

function is_editor(url) {
    try {
        const u = new URL(url);
        if (u.hostname !== "docs.google.com") return false;
        return /\/document\/(?:u\/\d+\/)?d\/|\/spreadsheets\/(?:u\/\d+\/)?d\/|\/presentation\/(?:u\/\d+\/)?d\//.test(u.pathname);
    } catch {
        return false;
    }
}

function is_home(url) {
    try {
        const u = new URL(url);
        if (u.hostname === "drive.google.com") return true;
        if (u.hostname === "docs.google.com") return !is_editor(url);
        return false;
    } catch {
        return false;
    }
}

function set_status(text) {
    const el = document.getElementById("status");
    el.textContent = text ?? "";
}

function bubble_size_for_name(name) {
    const n = String(name ?? "").trim().length;
    if (n <= 4) return 42;
    if (n <= 8) return 52;
    if (n <= 14) return 64;
    if (n <= 22) return 76;
    return 88;
}

function compute_field_height(group_names) {
    if (!Array.isArray(group_names) || group_names.length === 0) return 0;
    const max_size = Math.max(...group_names.map((g) => bubble_size_for_name(g)));
    const estimated = 20 + group_names.length * 24 + Math.round(max_size * 0.65);
    return Math.max(max_size + 8, Math.min(230, estimated));
}

function bubble_anchor_for_index(index, total, bubble_size, field_height) {
    if (total <= 1) {
        return { x: 50, y: Math.max(8 + bubble_size / 2, Math.min(field_height - bubble_size / 2 - 8, field_height * 0.45)) };
    }

    const progress = index / Math.max(1, total - 1); // recent first -> top
    const top_bound = 6 + bubble_size / 2;
    const bottom_bound = Math.max(top_bound, field_height - bubble_size / 2 - 6);
    const base_y = top_bound + progress * (bottom_bound - top_bound);
    const x_pattern = [18, 43, 68, 30, 56, 80, 24, 50, 74, 36, 62];
    const x = x_pattern[index % x_pattern.length];
    const x_jitter = ((index * 11) % 7) - 3; // [-3..3]
    const y_jitter = ((index * 7) % 13) - 6;  // [-6..6]

    return {
        x: Math.max(10, Math.min(90, x + x_jitter)),
        y: Math.max(top_bound, Math.min(bottom_bound, base_y + y_jitter)),
    };
}

function bubble_drift_for_anchor(index, pos, bubble_size, field_width, field_height) {
    const cx = (pos.x / 100) * field_width;
    const cy = pos.y;
    const r = bubble_size / 2;
    const pad = 3;

    const left_space = cx - r - pad;
    const right_space = field_width - cx - r - pad;
    const top_space = cy - r - pad;
    const bottom_space = field_height - cy - r - pad;

    let dir_x = index % 2 === 0 ? 1 : -1;
    if (left_space < 8) dir_x = 1;
    else if (right_space < 8) dir_x = -1;

    let dir_y = index % 3 === 0 ? 1 : -1;
    if (top_space < 8) dir_y = 1;
    else if (bottom_space < 8) dir_y = -1;

    const avail_x = dir_x > 0 ? right_space : left_space;
    const avail_y = dir_y > 0 ? bottom_space : top_space;
    const amp_x = Math.max(0, Math.min(16, Math.floor(avail_x)));
    const amp_y = Math.max(0, Math.min(12, Math.floor(avail_y)));

    return {
        dx: `${dir_x * amp_x}px`,
        dy: `${dir_y * amp_y}px`,
    };
}

function show_create_row(show) {
    const row = document.getElementById("create_row");
    row.classList.toggle("hidden", !show);
}

let selected_group_name = null;
let current_view = "main";

function item_label(item) {
    return item?.name || "(untitled)";
}

function show_manage_panel(show) {
    const panel = document.getElementById("manage_panel");
    panel.classList.toggle("hidden", !show);
}

function is_manage_panel_visible() {
    const panel = document.getElementById("manage_panel");
    return !panel.classList.contains("hidden");
}

async function is_group_empty(group_name) {
    const resp = await send_to_sw({ type: "GET_GROUP", group_name }).catch(() => null);
    const items = resp?.group?.items;
    return !Array.isArray(items) || items.length === 0;
}

async function open_manage_group(group_name) {
    selected_group_name = group_name;
    const title = document.getElementById("manage_group_title");
    const items_container = document.getElementById("manage_items");
    title.textContent = `manage: ${group_name}`;
    items_container.innerHTML = "";

    const resp = await send_to_sw({ type: "GET_GROUP", group_name });
    const items = resp?.group?.items ?? [];

    if (!resp?.ok || !resp?.group) {
        show_manage_panel(false);
        set_status(`group "${group_name}" not found`);
        return;
    }

    if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "item-row";
        empty.textContent = "no files in this group";
        items_container.appendChild(empty);
    } else {
        for (const item of items) {
            const row = document.createElement("div");
            row.className = "item-row";

            const label = document.createElement("div");
            label.className = "item-label";
            label.textContent = item_label(item);

            const del = document.createElement("button");
            del.className = "danger";
            del.textContent = "remove";
            del.addEventListener("click", async () => {
                const out = await send_to_sw({
                    type: "REMOVE_ITEM_FROM_GROUP",
                    group_name,
                    item,
                });
                if (!out?.ok) {
                    set_status(out?.error || "could not remove item");
                    return;
                }
                set_status("removed file from group");
                await open_manage_group(group_name);
            });

            row.appendChild(label);
            row.appendChild(del);
            items_container.appendChild(row);
        }
    }

    show_manage_panel(true);
}

async function refresh_groups_ui() {
    const container = document.getElementById("bubble_container");
    const create_slot = document.getElementById("create_slot");
    const list_container = document.getElementById("list_container");
    const list_create_slot = document.getElementById("list_create_slot");
    container.innerHTML = "";
    create_slot.innerHTML = "";
    list_container.innerHTML = "";
    list_create_slot.innerHTML = "";

    const resp = await send_to_sw({ type: "LIST_GROUPS" });
    const groups = resp?.groups ?? [];
    const field_height = compute_field_height(groups);
    container.style.height = `${field_height}px`;
    const field_width = container.clientWidth || 276;

    // existing groups as bubbles
    for (let i = 0; i < groups.length; i += 1) {
        const g = groups[i];
        const bubble_size = bubble_size_for_name(g);
        const row = document.createElement("div");
        row.className = "bubble-row";
        const pos = bubble_anchor_for_index(i, groups.length, bubble_size, field_height);
        const drift = bubble_drift_for_anchor(i, pos, bubble_size, field_width, field_height);
        row.style.left = `${pos.x}%`;
        row.style.top = `${pos.y}px`;
        row.style.zIndex = String(1000 - i);
        row.style.setProperty("--drift-x", drift.dx);
        row.style.setProperty("--drift-y", drift.dy);

        const b = document.createElement("div");
        b.className = "bubble";
        b.textContent = g;
        b.style.setProperty("--bubble-size", `${bubble_size}px`);
        b.addEventListener("click", async () => {
            await add_curr_to_group(g);
        });

        const manage = document.createElement("button");
        manage.className = "mini-button group-manage-btn";
        manage.textContent = "manage";
        manage.addEventListener("click", async () => {
            if (selected_group_name === g && is_manage_panel_visible()) {
                selected_group_name = null;
                show_manage_panel(false);
                return;
            }
            await open_manage_group(g);
        });

        row.appendChild(b);
        row.appendChild(manage);
        container.appendChild(row);

        const list_row = document.createElement("div");
        list_row.className = "list-row";

        const name = document.createElement("div");
        name.className = "list-name";
        name.textContent = g;
        name.addEventListener("click", async () => {
            await add_curr_to_group(g);
        });

        const list_manage = document.createElement("button");
        list_manage.className = "list-manage-btn";
        list_manage.textContent = "manage";
        list_manage.addEventListener("click", async () => {
            if (selected_group_name === g && is_manage_panel_visible()) {
                selected_group_name = null;
                show_manage_panel(false);
                return;
            }
            await open_manage_group(g);
        });

        list_row.appendChild(name);
        list_row.appendChild(list_manage);
        list_container.appendChild(list_row);
    }

    // create-new bubble
    const create_row = document.createElement("div");
    create_row.className = "create-bubble-row";

    const create = document.createElement("div");
    create.className = "bubble primary create-bubble";
    create.textContent = "+ create new";
    create.addEventListener("click", () => {
        show_create_row(true);
        document.getElementById("new_group_name").focus();
    });
    create_row.appendChild(create);
    create_slot.appendChild(create_row);

    const list_create = document.createElement("div");
    list_create.className = "list-row list-row-create";
    list_create.textContent = "+ create new";
    list_create.addEventListener("click", () => {
        show_create_row(true);
        document.getElementById("new_group_name").focus();
    });
    list_create_slot.appendChild(list_create);

    if (selected_group_name && groups.includes(selected_group_name)) {
        await open_manage_group(selected_group_name);
    } else {
        selected_group_name = null;
        show_manage_panel(false);
    }
}

async function add_curr_to_group(group_name) {
    set_status("collecting items...");

    const tab = await get_active_tab();
    const url = tab?.url ?? "";

    // case 1: editor page -> add current doc
    if (is_editor(url)) {
        const add_curr = await send_to_sw({
            type: "ADD_CURR_URL_TO_GROUP",
            group_name,
            url,
            title: tab?.title ?? "",
        });

        if (!add_curr?.ok) {
            set_status(add_curr?.error || "could not add current doc");
            return;
        }

        const open_resp = await send_to_sw({ type: "OPEN_GROUP", group_name, source_tab_id: tab?.id });
        if (!open_resp?.ok) {
            set_status(open_resp?.error || `added current doc but could not open "${group_name}"`);
            return;
        }

        set_status(`added current doc and opened "${group_name}"`);
        return;
    }

    // case 2 & 3: drive or docs home -> ask content script for selected
    if (is_home(url)) {
        const selected = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTED_ITEMS" }).catch(() => null);
        if (!selected?.ok) {
            if (await is_group_empty(group_name)) {
                set_status(`"${group_name}" is currently empty`);
                return;
            }
            const open_resp = await send_to_sw({ type: "OPEN_GROUP", group_name, source_tab_id: tab?.id });
            if (!open_resp?.ok) {
                set_status("could not read selection from page");
                return;
            }

            set_status(`opened "${group_name}"`);
            return;
        }

        const items = selected?.items ?? [];

        if (items.length === 0) {
            if (await is_group_empty(group_name)) {
                set_status(`"${group_name}" is currently empty`);
                return;
            }
            const open_resp = await send_to_sw({ type: "OPEN_GROUP", group_name, source_tab_id: tab?.id });
            if (!open_resp?.ok) {
                set_status("nothing selected");
                return;
            }

            set_status(`opened "${group_name}"`);
            return;
        }

        const add_resp = await send_to_sw({ type: "ADD_ITEMS_TO_GROUP", group_name, items });
        if (!add_resp?.ok) {
            set_status(add_resp?.error || "could not add selected items");
            return;
        }

        set_status(`added ${items.length} item(s) to "${group_name}"`);
        return;
    }

    if (await is_group_empty(group_name)) {
        set_status(`"${group_name}" is currently empty`);
        return;
    }

    const open_resp = await send_to_sw({ type: "OPEN_GROUP", group_name, source_tab_id: tab?.id });
    if (!open_resp?.ok) {
        set_status("not on Google Docs/Drive");
        return;
    }

    set_status(`opened "${group_name}"`);
}

document.addEventListener("DOMContentLoaded", async () => {
    const views_inner = document.getElementById("views_inner");
    const view_toggle_button = document.getElementById("view_toggle_button");
    view_toggle_button.addEventListener("click", () => {
        current_view = current_view === "main" ? "list" : "main";
        views_inner.classList.remove("flip");
        // restart animation
        void views_inner.offsetWidth;
        views_inner.classList.add("flip");
        views_inner.classList.toggle("is-list", current_view === "list");
        view_toggle_button.textContent = current_view === "list" ? "bubble view" : "list view";
    });

    document.getElementById("add_link_button").addEventListener("click", async () => {
        if (!selected_group_name) {
            set_status("select a group in manage first");
            return;
        }

        const input = document.getElementById("add_link_input");
        const url = (input.value ?? "").trim();
        if (!url) {
            set_status("enter a link");
            return;
        }

        const out = await send_to_sw({
            type: "ADD_LINK_TO_GROUP",
            group_name: selected_group_name,
            url,
        });
        if (!out?.ok) {
            set_status(out?.error || "could not add link");
            return;
        }

        input.value = "";
        set_status(`added link to "${selected_group_name}"`);
        await open_manage_group(selected_group_name);
    });

    document.getElementById("rename_group_button").addEventListener("click", async () => {
        if (!selected_group_name) return;
        const old_name = selected_group_name;
        const proposed = window.prompt("Rename group to:", old_name);
        if (proposed == null) return;

        const new_name = proposed.trim();
        if (!new_name || new_name === old_name) return;

        const out = await send_to_sw({
            type: "RENAME_GROUP",
            old_group_name: old_name,
            new_group_name: new_name,
        });
        if (!out?.ok) {
            set_status(out?.error || "could not rename group");
            return;
        }

        selected_group_name = new_name;
        await refresh_groups_ui();
        set_status(`renamed "${old_name}" to "${new_name}"`);
    });

    document.getElementById("delete_group_button").addEventListener("click", async () => {
        if (!selected_group_name) return;
        const name = selected_group_name;
        const out = await send_to_sw({ type: "DELETE_GROUP", group_name: name });
        if (!out?.ok) {
            set_status(out?.error || "could not delete group");
            return;
        }
        selected_group_name = null;
        show_manage_panel(false);
        await refresh_groups_ui();
        set_status(`deleted "${name}"`);
    });

    document.getElementById("create_button").addEventListener("click", async () => {
        const name = (document.getElementById("new_group_name").value ?? "").trim();
        if (!name) {
            set_status("enter a group name");
            return;
        }
        const create_resp = await send_to_sw({ type: "CREATE_GROUP", group_name: name });
        if (!create_resp?.ok) {
            set_status(create_resp?.error || "could not create group");
            return;
        }

        document.getElementById("new_group_name").value = "";
        show_create_row(false);
        await refresh_groups_ui();
        set_status(`created "${name}". click it to add.`);
    });

    document.getElementById("cancel_button").addEventListener("click", () => {
        show_create_row(false);
        set_status("");
    });

    await refresh_groups_ui();
});

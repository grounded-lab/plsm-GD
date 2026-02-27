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
        return /\/document\/d\/|\/spreadsheets\/d\/|\/presentation\/d\//.test(u.pathname);
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

function show_create_row(show) {
    const row = document.getElementById("create_row");
    row.classList.toggle("hidden", !show);
}

async function refresh_groups_ui() {
    const container = document.getElementById("bubble_container");
    container.innerHTML = "";

    const resp = await send_to_sw({ type: "LIST_GROUPS" });
    const groups = resp?.groups ?? [];

    // existing groups as bubbles
    for (const g of groups) {
        const b = document.createElement("div");
        b.className = "bubble";
        b.textContent = g;
        b.addEventListener("click", async () => {
            // clicking a group bubble = "add current context selection to this group"
            await add_curr_to_group(g);
        });
        container.appendChild(b);
    }

    // create-new bubble
    const create = document.createElement("div");
    create.className = "bubble primary";
    create.textContent = "+ create new";
    create.addEventListener("click", () => {
        show_create_row(true);
        document.getElementById("new_group_name").focus();
    });
    container.appendChild(create);
}

async function add_curr_to_group(group_name) {
    set_status("collecting items...");

    const tab = await get_active_tab();
    const url = tab?.url ?? "";

    // case 1: editor page -> add current doc
    if (is_editor(url)) {
        const item_resp = await send_to_sw({
            type: "ADD_ITEMS_TO_GROUP",
            group_name,
            items: []
        });

        const add_curr = await send_to_sw({
            type: "ADD_CURR_URL_TO_GROUP",
            group_name,
            url
        });

        if (add_curr?.ok) {
            set_status(`added current doc to "${group_name}"`);
            return;
        }

        set_status("could not add current doc");
        return;
    }

    // case 2 & 3: drive or docs home -> ask content script for selected
    if (is_home(url)) {
        const selected = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTED_ITEMS" }).catch(() => null);
        const items = selected?.items ?? [];

        if (items.length === 0) {
            set_status("nothing selected");
            return;
        }

        await send_to_sw({ type: "ADD_ITEMS_TO_GROUP", group_name, items });
        set_status(`added ${items.length} item(s) to "${group_name}"`);
        return;
    }

    set_status("not on Google Docs/Drive");
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("create_button").addEventListener("click", async () => {
        const name = (document.getElementById("new_group_name").value ?? "").trim();
        if (!name) {
            set_status("enter a group name");
            return;
        }
        await send_to_sw({ type: "CREATE_GROUP", group_name: name });
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

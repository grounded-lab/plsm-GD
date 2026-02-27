/**
* handles::get selected items
* Drive multi-select
* Docs "home" multi-select
*/

/**
 * note:
 * DOM in Drive/Docs is messy and changes,
 * so this code is intentionally modular.
 */

/**
 * get defined context.
 * "DOC_PAGE": a specific doc/sheet/slide file page
 * "DRIVE": drive.google.com
 * "DOCS_HOME": docs.google.com "home" views (not /document/d/)
 */

function detect_context() {
    const host = location.hostname;

    if (host === "drive.google.com") return "DRIVE";
    if (host === "docs.google.com") {
        const p = location.pathname;
        if (/\/document\/d\/|\/spreadsheets\/d\/|\/presentation\/d\//.test(p)) return "DOC_PAGE";
        return "DOCS_HOME";
    }

    return "UNKNOWN";
}

function unique_by_key(items) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = `${item.type}:${item.id}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
        }
    }

    return out;
}

/**
 * extract selected file IDs from Drive DOM.
 */
function get_selected_drive() {
  const items = [];
  
  const selected_nodes = Array.from(document.querySelectorAll('[aria-selected="true"]'));

  for (const node of selected_nodes) {
    let id = null;
    let type = null;

    // try for href containing /file/d/<ID> or /folders/<ID>
    const link = 
        node.querySelector('a[href*="/file/d/"], a[href*="/folders/"]') || 
        node.closest('a[href*="/file/d/"], a[href*="/folders/"]');

    if (link?.href) {
      const file_match= link.href.match(/\/file\/d\/([^/]+)/);
      if (file_match) { id = file_match[1], type = "drive_file" };

      const folder_match= link.href.match(/\/folders\/d\/([^/]+)/);
      if (folder_match) { id = folder_match[1], type = "drive_folder" };
    }

    // if href didn't resolve type, check mime-type attribute
    if (!type) {
      const mime =
        node.getAttribute("data-mime-type") ||
        node.dataset?.mimeType ||
        node.querySelector('[data-mime-type]')?.getAttribute("data-mime-type");

      if (mime === "application/vnd.google-apps.folder") {
        id = id || node.getAttribute("data-id") || node.dataset?.id;
        type = "drive_folder";
      } else if (mime) {
        id = id || node.getAttribute("data-id") || node.dataset?.id;
        type = "drive_file";
      }
    }

    // fallback: check aria-label for "Folder"
    if (!type) {
      const label = node.getAttribute("aria-label") || "";
      if (/folder/i.test(label)) {
        id = id || node.getAttribute("data-id") || node.dataset?.id;
        type = "drive_folder";
      }
    }

    if (id && type) {
      items.push({ id, type });
    }
  }

  return unique_by_key(items);
}

/**
 * extract selected items from docs home. 
 */
function get_selected_docs() {
  const items = [];

  const selected_nodes = Array.from(document.querySelectorAll('[aria-selected="true"]'));

  for (const node of selected_nodes) {
    // look for href containing /document/d/<ID>, /spreadsheets/d/<ID>, /presentation/d/<ID>
    const link =
      node.querySelector('a[href*="/document/d/"], a[href*="/spreadsheets/d/"], a[href*="/presentation/d/"]') ||
      node.closest('a[href*="/document/d/"], a[href*="/spreadsheets/d/"], a[href*="/presentation/d/"]');

    if (!link?.href) continue;

    const href = link.href;
    const doc = href.match(/\/document\/d\/([^/]+)/);
    if (doc) {
      items.push({ id: doc[1], type: "doc" });
      continue;
    }
    const sheet = href.match(/\/spreadsheets\/d\/([^/]+)/);
    if (sheet) {
      items.push({ id: sheet[1], type: "sheet" });
      continue;
    }
    const slide = href.match(/\/presentation\/d\/([^/]+)/);
    if (slide) {
      items.push({ id: slide[1], type: "slide" });
      continue;
    }
  }

  return unique_by_key(items);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;

    if (type === "GET_SELECTED_ITEMS") {
    const ctx = detect_context();

    let items = [];
    if (ctx === "DRIVE") items = get_selected_drive();
    else if (ctx === "DOCS_HOME") items = get_selected_docs();
    else items = [];

    sendResponse({ ok: true, context: ctx, items });
    return true;
  }

  // unknown: ignore
  return false;
})


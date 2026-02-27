# plsm-GD

project-level session memory for Google Docs

---

**core idea**:
Group docs into project-level sets.  
Opening one auto-restores the working set.

---

**what**:
A Chrome extension.  
Goal: restore working context instantly.

Instead of reopening multiple file editors manually after every browser restart, you define a project once and reopen everything relevant in one action.

---

**it allows you to**:
- Add the current Google Doc/Sheet/Slide to a named group
- Add selected files from Drive or Docs Home to a group
- Add entire Drive folders as dynamic groups
- Update existing groups or create a new group

---

**what it does**:
- Reopen all items in a group as a single Chrome tab group

---

**features**:
- Groups store normalized file IDs, so they remain stable across sessions.
- Folders are treated as sets: when reopened, their current contents are fetched and opened.
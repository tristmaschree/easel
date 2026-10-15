// Cmd/Ctrl+K command palette: fuzzy-jump to any course, course section,
// assignment, page, module item, file, or upcoming due item.
JV.features.palette = (() => {
  const { h, svg } = JV.util;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const RECENTS_KEY = `jv:${location.host}:recents`;
  const KIND_LABEL = {
    course: "Course", section: "Section", assignment: "Assignment", quiz: "Quiz", discussion: "Discussion",
    page: "Page", module: "Module", file: "File", externalurl: "Link", externaltool: "Tool",
    due: "Due", nav: "Go to", action: "Action",
  };

  let host, shadow, input, list, footer;
  let entries = [];
  let results = [];
  let active = 0;
  let isOpen = false;
  let indexing = 0;
  let recents = [];
  let courses = [];
  let indexPromise = null;
  const ensureIndex = () => (indexPromise ||= buildIndex());

  const STATIC = [
    { title: "Dashboard", url: "/", kind: "nav" },
    { title: "Calendar", url: "/calendar", kind: "nav" },
    { title: "Inbox", url: "/conversations", kind: "nav" },
    { title: "All grades", url: "/grades", kind: "nav" },
    { title: "All courses", url: "/courses", kind: "nav" },
    { title: "Account settings", url: "/profile/settings", kind: "nav" },
    { title: "Open Due panel", kind: "action", run: () => JV.features.due.open() },
  ];

  // ---------- index ----------

  async function buildIndex() {
    courses = (await JV.data.courses().catch(() => [])) || [];
    const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
    const base = [
      ...STATIC,
      ...courses.map((c) => ({ title: c.name, sub: [c.short, c.term].filter(Boolean).join(" · "), url: c.url, kind: "course", courseId: c.id })),
    ];
    const due = await JV.data.plannerItems().catch(() => []);
    const dueEntries = (due || [])
      .filter((it) => !it.done && new Date(it.due) > Date.now() - 7 * JV.util.DAY)
      .map((it) => ({
        title: it.title,
        sub: `${byId[it.courseId]?.short || it.context} · due ${JV.util.fmtDue(new Date(it.due))}`,
        url: it.url,
        kind: "due",
        courseId: it.courseId,
      }));
    entries = [...base, ...dueEntries];
    refilter();

    indexing = courses.length;
    renderFooter();
    await JV.util.pool(courses, 3, async (c) => {
      const items = await JV.data.courseIndex(c).catch(() => []);
      const add = (items || []).map((it) => ({
        title: it.k === "section" ? `${c.short} › ${it.t}` : it.t,
        sub: `${c.short} · ${KIND_LABEL[it.k] || it.k}`,
        url: it.u,
        kind: it.k,
        courseId: c.id,
      }));
      entries = entries.concat(add);
      indexing--;
      refilter();
      renderFooter();
    });
  }

  // ---------- search ----------

  function isSubsequence(needle, hay) {
    let i = 0;
    for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
    return false;
  }

  function score(entry, tokens, currentCourse, recentUrls) {
    const title = entry.title.toLowerCase();
    const extra = (entry._extra ||= `${entry.sub || ""} ${courses.find((c) => c.id === entry.courseId)?.code || ""}`.toLowerCase());
    let s = 0;
    for (const t of tokens) {
      const i = title.indexOf(t);
      if (i === 0) s += 10;
      else if (i > 0 && /[\s\-_:›(]/.test(title[i - 1])) s += 8;
      else if (i > 0) s += 5;
      else if (extra.includes(t)) s += 3;
      else if (t.length > 1 && isSubsequence(t, title)) s += 1;
      else return -1;
    }
    if (entry.kind === "course") s += 4;
    if (entry.kind === "section" || entry.kind === "nav") s += 2;
    if (currentCourse && entry.courseId === currentCourse) s += 2;
    if (recentUrls.has(entry.url)) s += 3;
    return s - title.length / 200;
  }

  function refilter() {
    if (!isOpen) return;
    const q = input.value.trim().toLowerCase();
    const current = JV.util.currentCourseId();
    if (!q) {
      const seen = new Set();
      const currentSections = entries.filter((e) => e.kind === "section" && e.courseId === current);
      results = [
        ...recents.map((r) => ({ ...r, recent: true })),
        ...currentSections,
        ...entries.filter((e) => e.kind === "course" || e.kind === "nav" || e.kind === "action"),
      ].filter((e) => {
        const k = e.url || e.title;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else {
      const tokens = q.split(/\s+/);
      const recentUrls = new Set(recents.map((r) => r.url));
      const seen = new Set();
      results = entries
        .map((e) => [e, score(e, tokens, current, recentUrls)])
        .filter(([, s]) => s >= 0)
        .sort((a, b) => b[1] - a[1])
        .map(([e]) => e)
        .filter((e) => {
          const k = `${e.url}|${e.title}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 60);
    }
    active = Math.min(active, Math.max(0, results.length - 1));
    renderList();
  }

  // ---------- rendering ----------

  function renderList() {
    const colorOf = (id) => courses.find((c) => c.id === id)?.color;
    list.replaceChildren(
      ...results.map((e, i) =>
        h(
          "li",
          {
            class: `item${i === active ? " active" : ""}`,
            role: "option",
            "aria-selected": String(i === active),
            style: { "--c": colorOf(e.courseId) || "#8b969e" },
            onmousemove: () => { if (active !== i) { active = i; highlight(); } },
            onclick: (ev) => choose(e, ev.metaKey || ev.ctrlKey),
          },
          h("span", { class: "dot", "aria-hidden": "true" }),
          h("div", { class: "text" }, h("div", { class: "title" }, e.title), e.sub ? h("div", { class: "sub" }, e.sub) : null),
          h("span", { class: "kind" }, e.recent ? "Recent" : KIND_LABEL[e.kind] || e.kind)
        )
      )
    );
    if (!results.length) list.append(h("li", { class: "none" }, indexing ? "Searching…" : "No matches"));
    highlight();
  }

  function highlight() {
    [...list.children].forEach((li, i) => {
      li.classList.toggle("active", i === active);
      li.setAttribute("aria-selected", String(i === active));
    });
    list.children[active]?.scrollIntoView({ block: "nearest" });
  }

  function renderFooter() {
    if (!footer) return;
    const mod = isMac ? "⌘" : "Ctrl";
    footer.replaceChildren(
      h("span", null, h("kbd", null, "↑↓"), " navigate  ", h("kbd", null, "↵"), " open  ", h("kbd", null, `${mod}↵`), " new tab  ", h("kbd", null, "esc"), " close"),
      h("span", { class: "status" }, indexing > 0 ? `Indexing ${indexing} course${indexing === 1 ? "" : "s"}…` : "")
    );
  }

  // ---------- actions ----------

  async function choose(entry, newTab) {
    if (!entry) return;
    close();
    if (entry.run) return entry.run();
    const { title, sub, url, kind, courseId } = entry;
    recents = [{ title, sub, url, kind, courseId }, ...recents.filter((r) => r.url !== url)].slice(0, 8);
    await chrome.storage.local.set({ [RECENTS_KEY]: recents });
    if (newTab) window.open(url, "_blank");
    else location.href = url;
  }

  function onKey(e) {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      active = Math.min(results.length - 1, active + 1);
      highlight();
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      active = Math.max(0, active - 1);
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active], e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function build() {
    host = h("div", { id: "jv-palette-host" });
    shadow = host.attachShadow({ mode: "open" });
    input = h("input", {
      type: "text",
      placeholder: "Jump to a course, assignment, page, file…",
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": "Search Canvas",
      oninput: () => { active = 0; refilter(); },
      onkeydown: onKey,
    });
    list = h("ul", { class: "list", role: "listbox" });
    footer = h("footer");
    const box = h(
      "div",
      { class: "box", role: "dialog", "aria-label": "Command palette" },
      h("div", { class: "search" },
        svg(`<svg viewBox="0 0 16 16" width="18" height="18"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`),
        input),
      list,
      footer
    );
    const backdrop = h("div", { class: "backdrop", onmousedown: (e) => { if (e.target === backdrop) close(); } }, box);
    shadow.append(h("style", null, CSS), backdrop);
    document.body.append(host);
    renderFooter();
  }

  async function open() {
    if (isOpen) return;
    if (!host) build();
    isOpen = true;
    host.hidden = false;
    input.value = "";
    active = 0;
    recents = (await chrome.storage.local.get(RECENTS_KEY))[RECENTS_KEY] || [];
    input.focus();
    ensureIndex();
    refilter();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    host.hidden = true;
  }

  function init() {
    window.addEventListener(
      "keydown",
      (e) => {
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
          if (e.target?.isContentEditable) return; // leave Cmd+K (insert link) to editors
          e.preventDefault();
          e.stopPropagation();
          isOpen ? close() : open();
        }
      },
      true
    );
    // Warm the index in the background so the first open is instant.
    (window.requestIdleCallback || setTimeout)(ensureIndex, { timeout: 5000 });
  }

  const CSS = `
    :host { all: initial; }
    :host([hidden]) { display: none; }
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed; inset: 0; z-index: 100001; background: rgba(20, 28, 36, .22);
      display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh;
      font-family: LatoWeb, "Lato Extended", Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 14px; color: #273540;
    }
    .box {
      width: min(640px, calc(100vw - 32px)); max-height: 70vh; border-radius: 14px;
      background: rgba(255, 255, 255, .76);
      -webkit-backdrop-filter: blur(28px) saturate(180%); backdrop-filter: blur(28px) saturate(180%);
      box-shadow: 0 24px 70px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.08), inset 0 0 0 1px rgba(255,255,255,.5);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .search { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid rgba(0,0,0,.08); color: #6b7780; }
    input { flex: 1; border: 0; outline: 0; font: inherit; font-size: 17px; color: #273540; background: transparent; }
    .list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; }
    /* Fixed height so one-line rows (Dashboard, Calendar…) match two-line course rows. */
    .item { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 10px; border-radius: 8px; cursor: pointer; }
    .item.active { background: color-mix(in srgb, var(--jv-blue-light) 70%, transparent); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
    .text { flex: 1; min-width: 0; }
    .title { font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 12px; line-height: 1.3; color: #6b7780; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kind { font-size: 11px; color: #6b7780; background: rgba(0,0,0,.06); border-radius: 4px; padding: 2px 6px; flex: none; }
    .item.active .kind { background: var(--jv-blue-light); color: var(--jv-blue-dark); }
    .none { padding: 24px; text-align: center; color: #8b969e; }
    footer { display: flex; justify-content: space-between; gap: 8px; padding: 8px 14px; border-top: 1px solid rgba(0,0,0,.08); font-size: 12px; color: #6b7780; }
    kbd { font-family: inherit; background: rgba(255,255,255,.6); border: 1px solid rgba(0,0,0,.12); border-radius: 4px; padding: 0 4px; font-size: 11px; }
  `;

  return { init, open, close };
})();

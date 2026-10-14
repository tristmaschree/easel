// Tree sidebar: Canvas's nav items stay as the top level, but Courses and
// Groups become folders — Courses > each course > its sections — replacing the
// separate per-course menu. Styling and layout live in styles/tree.css, keyed
// on html.jv-tree; the collapse arrow flips back to the icon strip.
JV.features.sidebarTree = (() => {
  const { h, svg } = JV.util;
  const STATE_KEY = `jv:${location.host}:tree`;
  const TWISTY = `<svg class="jv-tw jv-anim" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const wide = matchMedia("(min-width: 768px)");

  // Which folders are open. `open` holds per-course/group overrides; a course
  // with no override is open exactly when you're inside it.
  let state = { courses: true, groups: false, open: {} };
  const persist = () => chrome.storage.local.set({ [STATE_KEY]: state });
  const treeOn = () => document.documentElement.classList.contains("jv-tree") && wide.matches;

  function context() {
    const m = location.pathname.match(/^\/(courses|groups)\/(\d+)/);
    return m ? { kind: m[1], id: m[2] } : null;
  }

  // ---------- building blocks ----------

  function kids() {
    const inner = h("div", { class: "jv-tree-kids__inner jv-anim" });
    return [h("div", { class: "jv-tree-kids jv-anim" }, inner), inner];
  }

  // `due` (optional): the due-soon items that live under this section, shown
  // as a count so you can see where a course's badge comes from.
  function leaf(label, url, level, active, due) {
    const title = due?.length
      ? [label, ...due.map((it) => `• ${it.title} — due ${JV.util.fmtDue(new Date(it.due))}`)].join("\n")
      : label;
    return h(
      "a",
      { class: `jv-tree-leaf${active ? " is-active" : ""}`, href: url, title, style: { "--lvl": level }, "aria-current": active ? "page" : null },
      h("span", { class: "jv-tree-label" }, label),
      due?.length ? h("span", { class: "jv-tree-count" }, due.length) : null
    );
  }

  function note(text, level) {
    return h("div", { class: "jv-tree-note", style: { "--lvl": level } }, text);
  }

  // The current course's menu is already in the page (we only hide it), and is
  // the most accurate source: exact links, and Canvas's own idea of what's active.
  function scrapeTabs() {
    return [...document.querySelectorAll("#section-tabs a")]
      .map((a) => {
        const clone = a.cloneNode(true);
        clone.querySelectorAll(".screenreader-only, i, svg").forEach((n) => n.remove());
        return { label: clone.textContent.trim(), url: a.getAttribute("href"), active: a.classList.contains("active") };
      })
      .filter((t) => t.label && t.url);
  }

  function activeIndex(tabs) {
    const marked = tabs.findIndex((t) => t.active);
    if (marked >= 0) return marked;
    // Longest tab path that prefixes the current path ("Home" only matches exactly).
    const here = location.pathname.replace(/\/$/, "");
    let best = -1, bestLen = 0;
    tabs.forEach((t, i) => {
      const p = new URL(t.url, location.origin).pathname.replace(/\/$/, "");
      const isHome = /^\/(courses|groups)\/\d+$/.test(p);
      const hit = here === p || (!isHome && here.startsWith(p + "/"));
      if (hit && p.length > bestLen) [best, bestLen] = [i, p.length];
    });
    return best;
  }

  // Which section a due item belongs under: the tab whose path prefixes the
  // item's URL (…/assignments/12 -> Assignments), else a tab chosen by item
  // type (graded quizzes and discussions also live under Assignments), else Home.
  const TYPE_TABS = {
    quiz: ["quizzes", "assignments"],
    discussion_topic: ["discussion_topics", "assignments"],
    wiki_page: ["pages", "wiki"],
    assignment: ["assignments"],
    sub_assignment: ["assignments"],
  };
  function tabIndexFor(tabs, item) {
    const paths = tabs.map((t) => new URL(t.url, location.origin).pathname.replace(/\/$/, ""));
    const itemPath = new URL(item.url || "/", location.origin).pathname;
    let best = -1, bestLen = 0;
    paths.forEach((p, i) => {
      if (/^\/(courses|groups)\/\d+$/.test(p)) return; // Home matches everything
      if (itemPath.startsWith(p + "/") && p.length > bestLen) [best, bestLen] = [i, p.length];
    });
    if (best >= 0) return best;
    for (const seg of TYPE_TABS[item.type] || []) {
      const i = paths.findIndex((p) => p.endsWith(`/${seg}`));
      if (i >= 0) return i;
    }
    return 0;
  }

  async function fillTabs(inner, kind, id, level, due = []) {
    const here = context();
    const isCurrent = !!here && here.kind === kind && here.id === id;
    const render = (tabs) => {
      if (!tabs || !tabs.length) return inner.replaceChildren(leaf("Home", `/${kind}/${id}`, level, isCurrent, due));
      const act = isCurrent ? activeIndex(tabs) : -1;
      const byTab = tabs.map(() => []);
      for (const it of due) byTab[tabIndexFor(tabs, it)].push(it);
      inner.replaceChildren(...tabs.map((t, i) => leaf(t.label, t.url, level, i === act, byTab[i])));
    };
    if (isCurrent) {
      const scraped = scrapeTabs();
      if (scraped.length) return render(scraped);
    }
    inner.replaceChildren(note("Loading…", level));
    try {
      render(await JV.data.tabs(kind, id, render));
    } catch {
      render([]);
    }
  }

  // An expandable course or group. Sections load the first time it opens.
  function folder({ key, kind, id, label, sub, color, due = [], level }) {
    const here = context();
    const isCurrent = !!here && here.kind === kind && here.id === id;
    const [wrap, inner] = kids();
    const row = h(
      "button",
      { class: "jv-tree-row", type: "button", title: sub ? `${label} — ${sub}` : label, style: { "--lvl": level, "--jv-course": color } },
      svg(TWISTY),
      color ? h("span", { class: "jv-tree-dot" }) : null,
      h("span", { class: "jv-tree-label" }, label),
      h("span", { class: "jv-tree-sub" }, sub || ""),
      due.length ? h("span", { class: "jv-tree-count", title: `${due.length} due in the next 48 hours` }, due.length) : null
    );
    const el = h("div", { class: "jv-tree-folder" }, row, wrap);
    let loaded = false;
    const set = (open) => {
      el.classList.toggle("is-open", open);
      row.setAttribute("aria-expanded", String(open));
      if (open && !loaded) {
        loaded = true;
        fillTabs(inner, kind, id, level + 1, due);
      }
    };
    row.addEventListener("click", () => {
      const open = !el.classList.contains("is-open");
      set(open);
      state.open[key] = open;
      persist();
    });
    set(state.open[key] ?? isCurrent);
    return el;
  }

  // Turn one of Canvas's own nav items (Courses, Groups) into a folder: add a
  // twisty, and make a click expand it in place instead of opening the tray.
  function topBranch(linkId, stateKey, build) {
    const link = document.getElementById(linkId);
    if (!link) return;
    const li = JV.nav.itemFor(link);
    li.classList.add("jv-tree-top");
    link.prepend(svg(TWISTY));

    const [wrap, inner] = kids();
    const group = h(li.tagName.toLowerCase(), { class: "jv-tree-group" }, wrap);
    const set = (open) => {
      li.classList.toggle("jv-open", open);
      group.classList.toggle("is-open", open);
    };
    set(!!state[stateKey]);

    link.addEventListener(
      "click",
      (e) => {
        // In the collapsed strip (or a modified click) leave Canvas's behaviour alone.
        if (!treeOn() || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        state[stateKey] = !state[stateKey];
        set(state[stateKey]);
        persist();
      },
      true
    );

    JV.nav.keep(group, () => li);
    build(inner);
  }

  // ---------- branches ----------

  // Same rule as the badge on the collapsed strip's chips: not done, due in the next 48h.
  function dueSoonItems(items) {
    const now = Date.now();
    const out = {};
    for (const it of items || []) {
      if (it.done || !it.courseId) continue;
      const t = new Date(it.due).getTime();
      if (t >= now && t - now <= 48 * JV.util.HOUR) (out[it.courseId] ||= []).push(it);
    }
    return out;
  }

  async function buildCourses(inner) {
    let courses = [];
    let soon = {}; // courseId -> due-soon planner items
    const draw = () => {
      const here = context();
      const activeId = here?.kind === "courses" ? here.id : null;
      // Real classes only (as in the chip strip), plus whatever course you're in.
      let list = courses.filter((c) => c.isClass || c.id === activeId);
      if (!list.length) list = courses;
      if (activeId && !list.some((c) => c.id === activeId)) {
        const crumb = document.querySelector("#breadcrumbs li:nth-of-type(2)")?.textContent.trim();
        list = [...list, { id: activeId, name: crumb || "This course", short: crumb || "This course", isClass: false }];
      }
      // Let page styles (e.g. the breadcrumb chip) use the current course's colour.
      const activeColor = list.find((c) => c.id === activeId)?.color;
      document.documentElement.classList.toggle("jv-course-color", !!activeColor);
      if (activeColor) document.documentElement.style.setProperty("--jv-course-color", activeColor);
      inner.replaceChildren(
        ...list.map((c) =>
          folder({
            key: `c:${c.id}`,
            kind: "courses",
            id: c.id,
            label: c.isClass ? c.short : c.name,
            sub: c.isClass ? c.name.replace(/^[^:]*:\s*/, "") : "",
            color: c.color,
            due: soon[c.id] || [],
            level: 1,
          })
        ),
        leaf("All courses", "/courses", 1, location.pathname === "/courses")
      );
    };
    draw();
    const [c, planner] = await Promise.all([
      JV.data.courses((fresh) => { courses = fresh; draw(); }).catch(() => []),
      JV.data.plannerItems((fresh) => { soon = dueSoonItems(fresh); draw(); }).catch(() => []),
    ]);
    courses = c || [];
    soon = dueSoonItems(planner);
    draw();
  }

  async function buildGroups(inner) {
    const draw = (groups) =>
      inner.replaceChildren(
        ...(groups || []).map((g) => folder({ key: `g:${g.id}`, kind: "groups", id: g.id, label: g.name, level: 1 })),
        leaf("All groups", "/groups", 1, location.pathname === "/groups")
      );
    draw([]);
    draw(await JV.data.groups(draw).catch(() => []));
  }

  // The arrow at the bottom of the nav switches between tree and icon strip.
  function wireCollapse() {
    const toggle = document.getElementById("primaryNavToggle");
    if (!toggle) return;
    toggle.addEventListener(
      "click",
      (e) => {
        if (!wide.matches) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const on = document.documentElement.classList.toggle("jv-tree");
        JV.saveSetting("treeCollapsed", !on);
        window.dispatchEvent(new Event("resize")); // let panels re-anchor to the new edge
      },
      true
    );
  }

  async function init() {
    const saved = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
    if (saved) state = { ...state, ...saved, open: { ...saved.open } };
    if (!(await JV.nav.ready())) return;
    topBranch("global_nav_courses_link", "courses", buildCourses);
    topBranch("global_nav_groups_link", "groups", buildGroups);
    wireCollapse();
  }

  return { init };
})();

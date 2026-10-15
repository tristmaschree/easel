// A "Due" item in the global nav that opens one sorted list of everything due
// across all courses, with countdowns, urgency colors, and mark-as-done.
JV.features.due = (() => {
  const { h, svg, fmtDue, relTime, startOfDay, HOUR, DAY } = JV.util;

  const ICON = `<svg class="ic-icon-svg menu-item__icon" viewBox="0 0 1920 1920" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M960 0c529.2 0 960 430.8 960 960s-430.8 960-960 960S0 1489.2 0 960 430.8 0 960 0Zm0 112.9C492.9 112.9 112.9 492.9 112.9 960S492.9 1807.1 960 1807.1 1807.1 1427.1 1807.1 960 1427.1 112.9 960 112.9Zm56.5 282.4V937l352.5 352.5-79.9 79.9L903.5 983.8V395.3h113Z"/></svg>`;
  const TYPE_LABEL = {
    assignment: "Assignment",
    quiz: "Quiz",
    discussion_topic: "Discussion",
    wiki_page: "Page",
    planner_note: "To-do",
    calendar_event: "Event",
    assessment_request: "Peer review",
    sub_assignment: "Assignment",
  };

  let settings, host, shadow, body, badge, navItem, tick;
  let items = [];
  let courses = {};
  let isOpen = false;
  let error = null;

  // ---------- data ----------

  async function load() {
    try {
      const [list, cs] = await Promise.all([
        JV.data.plannerItems((fresh) => { items = fresh; update(); }),
        JV.data.courses().catch(() => []),
      ]);
      items = list || [];
      courses = Object.fromEntries((cs || []).map((c) => [c.id, c]));
      error = null;
    } catch (e) {
      error = e;
    }
    update();
  }

  function urgentCount() {
    const now = Date.now();
    return items.filter((it) => !it.done && new Date(it.due) - now <= 48 * HOUR).length;
  }

  function group() {
    const now = Date.now();
    const today = startOfDay(new Date()).getTime();
    const groups = { Overdue: [], Today: [], Tomorrow: [], "Next 7 days": [], Later: [], "Earlier (done)": [] };
    for (const it of items) {
      const t = new Date(it.due).getTime();
      if (t < now) {
        if (!it.done) groups.Overdue.push(it);
        else if (settings.showCompleted) groups["Earlier (done)"].push(it);
        continue;
      }
      if (it.done && !settings.showCompleted) continue;
      const days = Math.round((startOfDay(new Date(t)).getTime() - today) / DAY);
      if (days <= 0) groups.Today.push(it);
      else if (days === 1) groups.Tomorrow.push(it);
      else if (days < 7) groups["Next 7 days"].push(it);
      else groups.Later.push(it);
    }
    const byDue = (a, b) => new Date(a.due) - new Date(b.due);
    for (const [k, v] of Object.entries(groups)) v.sort(k === "Overdue" || k.startsWith("Earlier") ? (a, b) => byDue(b, a) : byDue);
    return groups;
  }

  // ---------- rendering ----------

  function urgency(it) {
    const diff = new Date(it.due) - Date.now();
    if (it.done) return "";
    if (diff < 0) return "overdue";
    if (diff < 24 * HOUR) return "high";
    if (diff < 72 * HOUR) return "med";
    return "";
  }

  function row(it) {
    const course = courses[it.courseId];
    const due = new Date(it.due);
    const chips = [];
    if (it.graded) chips.push(h("span", { class: "chip ok" }, "Graded"));
    else if (it.submitted) chips.push(h("span", { class: "chip ok" }, "Submitted"));
    if (it.missing) chips.push(h("span", { class: "chip bad" }, "Missing"));
    if (it.late) chips.push(h("span", { class: "chip warn" }, "Late"));

    const check = h(
      "button",
      {
        class: "check",
        role: "checkbox",
        "aria-checked": String(it.done),
        title: it.done ? "Mark as not done" : "Mark as done",
        onclick: () => toggleDone(it),
      },
      svg(`<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
    );

    return h(
      "li",
      { class: `row${it.done ? " done" : ""}`, style: { "--c": course?.color || "#8b969e" } },
      check,
      h(
        "div",
        { class: "main" },
        h("a", { class: "title", href: it.url || "#" }, it.title),
        h(
          "div",
          { class: "meta" },
          h("span", { class: "course" }, h("span", { class: "dot", "aria-hidden": "true" }), course?.short || it.context || ""),
          h("span", null, TYPE_LABEL[it.type] || ""),
          it.points ? h("span", null, `${it.points} pts`) : null,
          ...chips
        )
      ),
      h(
        "div",
        { class: "when" },
        h("div", { class: `rel ${urgency(it)}` }, it.done ? "Done" : relTime(due)),
        h("div", { class: "abs" }, fmtDue(due))
      )
    );
  }

  function renderBody() {
    if (!body) return;
    if (error) {
      body.replaceChildren(h("p", { class: "empty" }, "Couldn't load your planner. Are you signed in?"));
      return;
    }
    const groups = group();
    const sections = Object.entries(groups)
      .filter(([, v]) => v.length)
      .map(([name, v]) =>
        h(
          "section",
          { class: name === "Overdue" ? "overdue" : "" },
          h("h3", null, name, h("span", { class: "count" }, v.length)),
          h("ul", null, v.map(row))
        )
      );
    body.replaceChildren(...(sections.length ? sections : [h("p", { class: "empty" }, "Nothing due. Nice.")]));
  }

  function update() {
    if (badge) {
      const n = urgentCount();
      badge.textContent = n > 99 ? "99+" : n;
      badge.hidden = n === 0;
    }
    if (isOpen) renderBody();
  }

  async function toggleDone(it) {
    const next = !it.done;
    items = items.map((x) => (x.key === it.key ? { ...x, done: next } : x));
    update();
    try {
      await JV.data.setDone(it, next);
      const saved = await JV.data.plannerItems();
      if (saved) items = saved;
    } catch (e) {
      console.warn("[Easel] mark done failed", e);
      items = items.map((x) => (x.key === it.key ? { ...x, done: it.done } : x));
    }
    update();
  }

  // ---------- panel ----------

  function build() {
    host = h("div", { id: "jv-due-host" });
    shadow = host.attachShadow({ mode: "open" });
    shadow.append(h("style", null, CSS));

    const completedToggle = h("input", {
      type: "checkbox",
      checked: settings.showCompleted,
      onchange: (e) => {
        settings.showCompleted = e.target.checked;
        JV.saveSetting("showCompleted", settings.showCompleted);
        renderBody();
      },
    });

    body = h("div", { class: "body" });
    const panel = h(
      "div",
      { class: "panel", role: "dialog", "aria-label": "Due" },
      h(
        "header",
        null,
        h("h2", null, "Due"),
        h("label", { class: "toggle" }, completedToggle, "Show completed"),
        h("button", { class: "icon", title: "Refresh", onclick: forceRefresh },
          svg(`<svg viewBox="0 0 16 16" width="16" height="16"><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.5 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`)),
        h("button", { class: "icon", title: "Close (Esc)", onclick: () => toggle(false) },
          svg(`<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`))
      ),
      body
    );
    shadow.append(panel);
    document.body.append(host);
  }

  async function forceRefresh() {
    body.classList.add("loading");
    try {
      items = await JV.data.plannerItems.reload();
      error = null;
    } catch (e) {
      error = e;
    }
    body.classList.remove("loading");
    update();
  }

  function position() {
    host.style.setProperty("--jv-left", `${JV.nav.headerRight()}px`);
    // Match the panel's header to the page's own top bar (breadcrumbs, or the
    // dashboard header) so the two divider lines meet instead of sitting a few
    // pixels apart.
    const bar = document.querySelector(".ic-app-nav-toggle-and-crumbs, #dashboard_header_container");
    const h = bar ? Math.round(bar.offsetHeight) : 0;
    if (h >= 40 && h <= 120) {
      host.style.setProperty("--jv-head-h", `${h}px`);
      const line = getComputedStyle(bar).borderBottomColor;
      if (parseFloat(getComputedStyle(bar).borderBottomWidth)) host.style.setProperty("--jv-head-line", line);
    }
  }

  function toggle(force) {
    const next = force ?? !isOpen;
    if (!settings || next === isOpen) return; // not initialised (feature disabled)
    isOpen = next;
    if (isOpen) {
      if (!host) build();
      position();
      host.hidden = false;
      renderBody();
      tick = setInterval(renderBody, 60 * 1000);
      navItem?.classList.add("ic-app-header__menu-list-item--active");
    } else {
      host.hidden = true;
      clearInterval(tick);
      navItem?.classList.remove("ic-app-header__menu-list-item--active");
    }
  }

  function onOutside(e) {
    if (!isOpen) return;
    const path = e.composedPath();
    if (path.includes(host) || (navItem && path.includes(navItem))) return;
    toggle(false);
  }

  async function init(s) {
    settings = s;
    const coursesItem = await JV.nav.ready();
    if (coursesItem) {
      navItem = JV.nav.makeItem({ id: "jv_global_nav_due_link", label: "Due", icon: ICON, onClick: () => toggle() });
      navItem.classList.add("jv-nav-due");
      badge = h("span", { class: "jv-nav-badge", hidden: true });
      navItem.querySelector(".menu-item-icon-container")?.append(badge);
      // Sit just below the courses list (or the Courses item if that's disabled).
      JV.nav.keep(navItem, () =>
        document.querySelector(".jv-nav-courses") || JV.nav.itemFor(JV.nav.courseLink())
      );
    }
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) toggle(false);
    });
    window.addEventListener("resize", () => isOpen && position());
    load();
  }

  // Shares the tree sidebar's vocabulary (on frosted glass rather than white): same text colours,
  // same rounded hover tint, a colour dot + bold code for each course.
  const CSS = `
    :host { all: initial; }
    :host([hidden]) { display: none; }
    * { box-sizing: border-box; }
    .panel {
      --fg: #273540; --muted: #6b7780; --faint: #8b969e; --line: #e3e6e9;
      --hover: rgba(39, 53, 64, .06);
      --accent: var(--jv-blue); --accent-text: var(--jv-blue-dark);
      position: fixed; top: 0; bottom: 0; left: var(--jv-left, 0px);
      width: min(380px, calc(100vw - var(--jv-left, 0px)));
      z-index: 100000; color: var(--fg);
      /* Frosted glass: translucent enough that the page visibly blurs through,
         with a faint inner highlight along the right edge. */
      background: rgba(255, 255, 255, .62);
      -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%);
      font-family: LatoWeb, "Lato Extended", Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 13.5px; line-height: 1.3;
      /* Slides out from *under* the sidebar: a divider and soft shadow on the
         right only; the clip stops the shadow spilling left onto the sidebar. */
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, .6), 1px 0 0 var(--line), 12px 0 28px rgba(16, 24, 32, .1);
      clip-path: inset(0 -60px 0 0);
      display: flex; flex-direction: column;
    }
    header { display: flex; align-items: center; gap: 6px; flex: none; height: var(--jv-head-h, 72px); padding: 0 12px 0 18px; border-bottom: 1px solid var(--jv-head-line, var(--line)); }
    h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1; }
    .toggle { display: flex; align-items: center; gap: 6px; margin-right: 4px; font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; }
    .toggle input { margin: 0; accent-color: var(--accent); }
    .icon { border: 0; background: none; color: var(--muted); width: 30px; height: 30px; border-radius: 8px; cursor: pointer; display: grid; place-items: center; }
    .icon:hover { background: var(--hover); color: var(--fg); }
    .body { flex: 1; overflow-y: auto; padding: 4px 0 24px; scrollbar-width: thin; scrollbar-color: rgba(39, 53, 64, .2) transparent; }
    .body.loading { opacity: .5; }
    section { padding: 0 6px; }
    h3 { margin: 14px 12px 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); display: flex; gap: 6px; align-items: center; }
    section.overdue h3 { color: var(--jv-red-dark); }
    .count { background: var(--hover); color: var(--muted); border-radius: 8px; min-width: 16px; padding: 0 5px; font-size: 10px; line-height: 16px; letter-spacing: 0; text-align: center; }
    section.overdue .count { background: var(--jv-red-light); color: var(--jv-red-dark); }
    ul { list-style: none; margin: 0; padding: 0; }
    .row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 8px; }
    .row:hover { background: var(--hover); }
    .check {
      flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #c1c8cd; background: rgba(255, 255, 255, .7);
      color: transparent; display: grid; place-items: center; cursor: pointer; padding: 0;
    }
    .check:hover { border-color: var(--accent); color: var(--accent); }
    .row.done .check { background: var(--accent); border-color: var(--accent); color: #fff; }
    .main { flex: 1; min-width: 0; }
    .title { color: var(--fg); text-decoration: none; font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title:hover { color: var(--accent-text); text-decoration: underline; }
    .row.done .title { color: var(--faint); font-weight: 400; text-decoration: line-through; }
    .meta { display: flex; flex-wrap: wrap; gap: 3px 8px; font-size: 12px; color: var(--faint); margin-top: 2px; align-items: center; }
    .course { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
    .chip { font-size: 11px; padding: 0 6px; border-radius: 8px; font-weight: 700; }
    .chip.ok { background: var(--jv-green-light); color: var(--jv-green-dark); }
    .chip.bad { background: var(--jv-red-light); color: var(--jv-red-dark); }
    .chip.warn { background: var(--jv-yellow-light); color: var(--jv-orange); }
    .when { text-align: right; flex: none; }
    .rel { font-weight: 700; font-size: 12.5px; color: var(--muted); }
    .rel.overdue, .rel.high { color: var(--jv-red-dark); }
    .rel.med { color: var(--jv-orange); }
    .abs { font-size: 11px; color: var(--faint); white-space: nowrap; }
    .empty { text-align: center; color: var(--faint); margin-top: 48px; }
  `;

  return { init, toggle, open: () => toggle(true) };
})();

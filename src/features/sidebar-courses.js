// Your dashboard courses, always visible in the left nav under "Courses".
// Rendered from cache first, so it appears instantly on every page load.
JV.features.sidebarCourses = (() => {
  const { h } = JV.util;
  let root;

  function render(all, dueCounts = {}) {
    const active = JV.util.currentCourseId();
    // Hide org sites (placement exams, orientation…) unless they're all there is.
    const classes = all.filter((c) => c.isClass || c.id === active);
    const courses = classes.length ? classes : all;
    root.replaceChildren(
      ...courses.map((c) => {
        // "CPSC 2010" stacks as two lines inside the chip; anything else wraps.
        const [dept, num] = c.isClass ? c.short.split(" ") : [c.short || c.code];
        const due = dueCounts[c.id];
        const a = h(
          "a",
          {
            class: `jv-nav-course${c.id === active ? " is-active" : ""}`,
            href: c.url,
            "aria-label": c.name,
            style: { "--jv-course": c.color, "--jv-on": readableOn(c.color) },
          },
          h(
            "span",
            { class: "jv-nav-course__chip" },
            h("span", { class: "jv-nav-course__dept" }, dept),
            num ? h("span", { class: "jv-nav-course__num" }, num) : null
          ),
          due ? h("span", { class: "jv-nav-course__badge" }, due) : null
        );
        const name = c.name.replace(/^[^:]*:\s*/, "") || c.name;
        JV.nav.tooltip(a, due ? `${name} · ${due} due soon` : name);
        return a;
      })
    );
  }

  // Black or white text, whichever reads better on the course colour.
  function readableOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#202124" : "#fff";
  }

  function dueSoonByCourse(items) {
    const now = Date.now();
    const out = {};
    for (const it of items || []) {
      if (it.done || !it.courseId) continue;
      const t = new Date(it.due).getTime();
      if (t >= now && t - now <= 48 * JV.util.HOUR) out[it.courseId] = (out[it.courseId] || 0) + 1;
    }
    return out;
  }

  async function init() {
    const coursesItem = await JV.nav.ready();
    if (!coursesItem) return;

    root = h("div", { class: "jv-nav-courses__list" });
    const li = h(coursesItem.tagName.toLowerCase(), { class: "jv-nav-courses" }, root);
    JV.nav.keep(li, () => JV.nav.itemFor(JV.nav.courseLink()));

    let courses = [];
    let counts = {};
    const draw = () => render(courses, counts);

    const [c, planner] = await Promise.all([
      JV.data.courses((fresh) => { courses = fresh; draw(); }),
      JV.data.plannerItems((fresh) => { counts = dueSoonByCourse(fresh); draw(); }).catch(() => []),
    ]);
    courses = c || [];
    counts = dueSoonByCourse(planner);
    draw();
  }

  return { init, dueSoonByCourse };
})();

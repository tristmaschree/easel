// Shared, cached data sources. Each takes an optional `onFresh` callback that
// fires if a stale cached value was returned and fresher data has arrived.
JV.data = (() => {
  const { api, cache, util } = JV;
  // For courses with no colour set in Canvas: Google brand colours (see styles/palette.css).
  const FALLBACK_COLORS = ["#4285F4", "#EA4335", "#FBBC04", "#34A853", "#174EA6", "#A50E0E", "#E37400", "#0D652D"];

  function courses(onFresh) {
    return cache.swr("courses:v2", 30 * util.MIN, async () => {
      const [list, colors] = await Promise.all([
        // Favorites = the courses on the user's dashboard (Canvas falls back to
        // all current enrollments when nothing is favorited).
        api.get("/users/self/favorites/courses?include[]=term&per_page=100", { all: true }),
        api.get("/users/self/colors").catch(() => ({ custom_colors: {} })),
      ]);
      return list
        .filter((c) => c && c.name && !c.access_restricted_by_date)
        .map((c, i) => {
          const id = String(c.id);
          return {
            id,
            name: c.name,
            code: c.course_code || c.name,
            short: util.shortCode(c.course_code) || util.shortCode(c.name),
            isClass: util.isClassCode(c.course_code) || util.isClassCode(c.name),
            color: colors.custom_colors?.[`course_${id}`] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
            term: c.term?.name || "",
            url: `/courses/${id}`,
          };
        });
    }, onFresh);
  }

  async function fetchPlanner() {
    const now = Date.now();
    const start = new Date(now - 21 * util.DAY).toISOString();
    const end = new Date(now + 35 * util.DAY).toISOString();
    const raw = await api.get(
      `/planner/items?start_date=${start}&end_date=${end}&per_page=100`,
      { all: true, maxPages: 5 }
    );
    return raw.filter((it) => it.plannable_type !== "announcement").map(normalizePlannerItem);
  }

  function plannerItems(onFresh) {
    return cache.swr("planner", 5 * util.MIN, fetchPlanner, onFresh);
  }
  plannerItems.reload = () => cache.reload("planner", fetchPlanner);

  function normalizePlannerItem(it) {
    const p = it.plannable || {};
    const s = it.submissions || {};
    const override = it.planner_override;
    const submitted = !!(s.submitted || s.graded);
    return {
      key: `${it.plannable_type}_${it.plannable_id}`,
      type: it.plannable_type,
      id: String(it.plannable_id),
      title: p.title || p.name || "Untitled",
      url: it.html_url || "",
      courseId: it.course_id ? String(it.course_id) : null,
      context: it.context_name || (it.plannable_type === "planner_note" ? "To-do" : ""),
      due: it.plannable_date,
      points: p.points_possible ?? null,
      submitted,
      graded: !!s.graded,
      late: !!s.late,
      missing: !!s.missing,
      overrideId: override ? String(override.id) : null,
      // Same rule Canvas's own planner uses: an override wins, else submission status.
      done: override ? !!override.marked_complete : submitted,
    };
  }

  async function setDone(item, done) {
    const res = item.overrideId
      ? await api.send("PUT", `/planner/overrides/${item.overrideId}`, { marked_complete: done })
      : await api.send("POST", "/planner/overrides", {
          plannable_type: item.type,
          plannable_id: item.id,
          marked_complete: done,
        });
    await cache.patch("planner", (items) =>
      items.map((x) =>
        x.key === item.key ? { ...x, done, overrideId: res?.id ? String(res.id) : x.overrideId } : x
      )
    );
  }

  function grades(onFresh) {
    return cache.swr("grades", 10 * util.MIN, async () => {
      const enr = await api.get(
        "/users/self/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100",
        { all: true }
      );
      const out = {};
      for (const e of enr) {
        const g = e.grades || {};
        out[String(e.course_id)] = { score: g.current_score ?? null, grade: g.current_grade ?? null };
      }
      return out;
    }, onFresh);
  }

  // Everything searchable in one course, for the command palette.
  function courseIndex(course) {
    return cache.swr(`index:${course.id}`, 30 * util.MIN, async () => {
      const id = course.id;
      const safe = (p) => p.catch(() => []);
      const [tabs, assignments, pages, modules, files] = await Promise.all([
        safe(api.get(`/courses/${id}/tabs`)),
        safe(api.get(`/courses/${id}/assignments?per_page=100&order_by=due_at`, { all: true })),
        safe(api.get(`/courses/${id}/pages?per_page=100&sort=title`, { all: true })),
        safe(api.get(`/courses/${id}/modules?include[]=items&per_page=50`, { all: true })),
        safe(api.get(`/courses/${id}/files?per_page=100&sort=updated_at&order=desc`, { all: true, maxPages: 5 })),
      ]);

      const items = [];
      const seen = new Set();
      const add = (t, u, k) => {
        if (!t || !u) return;
        const dedupe = `${k === "section" ? "s" : "c"}:${t.toLowerCase()}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        items.push({ t, u, k });
      };

      for (const tab of tabs) if (!tab.hidden) add(tab.label, tab.html_url, "section");
      for (const a of assignments) add(a.name, a.html_url, a.quiz_id ? "quiz" : a.discussion_topic ? "discussion" : "assignment");
      for (const pg of pages) add(pg.title, pg.html_url || `/courses/${id}/pages/${pg.url}`, "page");
      for (const m of modules) {
        add(m.name, `/courses/${id}/modules#module_${m.id}`, "module");
        for (const it of m.items || []) {
          if (it.type === "SubHeader") continue;
          add(it.title, it.html_url, (it.type || "item").toLowerCase());
        }
      }
      for (const f of files) add(f.display_name, `/courses/${id}/files/${f.id}`, "file");
      return items;
    });
  }

  // The section menu (Home, Assignments, Grades…) of a course or group.
  // `kind` is "courses" or "groups".
  function tabs(kind, id, onFresh) {
    return cache.swr(`tabs:${kind}:${id}`, 6 * util.HOUR, async () => {
      const list = await api.get(`/${kind}/${id}/tabs?per_page=100`);
      return list.filter((t) => !t.hidden && t.html_url).map((t) => ({ label: t.label, url: t.html_url }));
    }, onFresh);
  }

  function groups(onFresh) {
    return cache.swr("groups", 30 * util.MIN, async () => {
      const list = await api.get("/users/self/groups?per_page=100", { all: true });
      return list.map((g) => ({ id: String(g.id), name: g.name, url: `/groups/${g.id}` }));
    }, onFresh);
  }

  return { courses, plannerItems, setDone, grades, courseIndex, tabs, groups };
})();

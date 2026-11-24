const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    if (!env.DB) return json({ error: "Database binding DB is not configured." }, 503);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "VAMSEE ticket API" });
    }
    if (request.method === "GET" && url.pathname === "/api/tickets") {
      const status = url.searchParams.get("status");
      const priority = url.searchParams.get("priority");
      let sql = "SELECT * FROM tickets";
      const where = [], values = [];
      if (status && ["OPEN","IN_PROGRESS","RESOLVED"].includes(status)) { where.push("status = ?"); values.push(status); }
      if (priority && ["HIGH","MEDIUM","NORMAL"].includes(priority)) { where.push("priority = ?"); values.push(priority); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY created_at DESC LIMIT 200";
      const { results } = await env.DB.prepare(sql).bind(...values).all();
      return json({ tickets: results });
    }
    if (request.method === "POST" && url.pathname === "/api/tickets") {
      let t;
      try { t = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      const required = ["id","customer_name","tracking_number","issue_type","priority","assigned_queue","next_action","customer_reply"];
      if (required.some(k => typeof t[k] !== "string" || !t[k].trim())) return json({ error: "Missing required ticket fields." }, 400);
      if (!["HIGH","MEDIUM","NORMAL"].includes(t.priority)) return json({ error: "Invalid priority." }, 400);
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO tickets
        (id, customer_name, tracking_number, issue_type, message, priority, assigned_queue, next_action, status, customer_reply, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`)
        .bind(t.id,t.customer_name,t.tracking_number,t.issue_type,t.message || "",t.priority,t.assigned_queue,t.next_action,t.customer_reply,now,now).run();
      return json({ ok: true, id: t.id }, 201);
    }
    const match = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!["OPEN","IN_PROGRESS","RESOLVED"].includes(body.status)) return json({ error: "Invalid status." }, 400);
      const result = await env.DB.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?")
        .bind(body.status,new Date().toISOString(),decodeURIComponent(match[1])).run();
      if (!result.meta.changes) return json({ error: "Ticket not found." }, 404);
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  }
};
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
    if (request.method === "POST" && url.pathname === "/api/assist") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      const allowedIssues = ["delay", "tracking", "delivery", "address", "damage"];
      if (!allowedIssues.includes(input.issue_type) || typeof input.customer_name !== "string" ||
          typeof input.tracking_number !== "string" || typeof input.message !== "string" ||
          !input.customer_name.trim() || !input.message.trim()) {
        return json({ error: "Provide a valid enquiry type, customer name, and message." }, 400);
      }
      if (!env.AI || typeof env.AI.run !== "function") {
        return json({ error: "Workers AI binding is not available yet. Check the AI binding in Wrangler settings." }, 503);
      }
      const issueLabels = { delay: "Shipment delayed", tracking: "Tracking not updated", delivery: "Marked delivered, not received", address: "Address correction request", damage: "Parcel damaged" };
      const prompt = `You are VAMSEE's logistics support copilot. Analyse this customer enquiry and return ONLY valid JSON, with no markdown.
Required JSON keys: priority, assigned_queue, next_action, customer_reply, reason.
priority must be exactly HIGH, MEDIUM, or NORMAL.
Choose HIGH for delivery marked delivered but not received, damaged parcels, or serious shipment delays; MEDIUM for stale tracking; NORMAL for address changes unless the message indicates urgency.
Use a concise, empathetic customer reply. Do not claim you checked a carrier system, do not invent shipment scans or delivery facts, do not promise a resolution time, and do not ask for sensitive payment/password information. For damage, ask the customer to preserve packaging and share photos through the verified support channel. For address changes, say eligibility must be checked before promising a change.
Customer name: ${input.customer_name.trim().slice(0,100)}
Tracking/AWB: ${input.tracking_number.trim().slice(0,100) || "Not provided"}
Enquiry type: ${issueLabels[input.issue_type]}
Customer message: ${input.message.trim().slice(0,1500)}
Return only JSON.`;
      try {
        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          prompt,
          max_tokens: 500,
          response_format: { type: "json_object" },
          chat_template_kwargs: { enable_thinking: false }
        });
        // Workers AI models may return plain text, a response/output field, or
        // an OpenAI-compatible choices/message/content envelope. Inspect all
        // text-bearing fields rather than assuming one response shape.
        const candidates = [];
        const collectText = (value, depth = 0) => {
          if (depth > 6 || value == null) return;
          if (typeof value === "string") { candidates.push(value); return; }
          if (Array.isArray(value)) { for (const item of value) collectText(item, depth + 1); return; }
          if (typeof value === "object") {
            for (const key of ["response", "output", "text", "content", "message", "choices", "result"]) {
              if (key in value) collectText(value[key], depth + 1);
            }
          }
        };
        collectText(result);
        if (typeof result === "string") candidates.unshift(result);
        let suggestion = null;
        for (const candidate of candidates) {
          const cleaned = candidate.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (!match) continue;
          try { suggestion = JSON.parse(match[0]); break; } catch {}
        }
        if (!suggestion) throw new Error("AI returned text, but no valid JSON object could be extracted.");
        if (!["HIGH", "MEDIUM", "NORMAL"].includes(suggestion.priority) ||
            typeof suggestion.assigned_queue !== "string" || typeof suggestion.next_action !== "string" ||
            typeof suggestion.customer_reply !== "string" || typeof suggestion.reason !== "string") {
          throw new Error("AI response did not match the expected format.");
        }
        return json({ ok: true, source: "workers-ai", priority: suggestion.priority,
          assigned_queue: suggestion.assigned_queue.slice(0,100), next_action: suggestion.next_action.slice(0,180),
          customer_reply: suggestion.customer_reply.slice(0,1200), reason: suggestion.reason.slice(0,240) });
      } catch (error) {
        return json({ error: "AI processing failed: " + error.message }, 502);
      }
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
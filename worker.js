const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
});

const SESSION_COOKIE = "vamsee_session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
async function sessionKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createSession(secret) {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), encoder.encode(expires));
  return expires + "." + toBase64Url(new Uint8Array(signature));
}
async function validSession(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(SESSION_COOKIE + "="));
  if (!part) return false;
  const pieces = part.slice(SESSION_COOKIE.length + 1).split(".");
  if (pieces.length !== 2 || !pieces[0].split("").every(ch => ch >= "0" && ch <= "9") ||
      Number(pieces[0]) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const signature = pieces[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = signature + "=".repeat((4 - signature.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", await sessionKey(secret), bytes, encoder.encode(pieces[0]));
  } catch { return false; }
}
function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}
async function passwordMatches(candidate, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Login and session endpoints are the only unauthenticated API routes.
    if (url.pathname === "/api/login" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "Request origin rejected." }, 403);
      if (!env.VAMSEE_ACCESS_PASSWORD || !env.VAMSEE_SESSION_SECRET || env.VAMSEE_SESSION_SECRET.length < 32) {
        return json({ error: "Access controls are not configured. Set VAMSEE_ACCESS_PASSWORD and a 32+ character VAMSEE_SESSION_SECRET in Worker secrets." }, 503);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      if (typeof body.password !== "string" || body.password.length > 256 ||
          !(await passwordMatches(body.password, env.VAMSEE_ACCESS_PASSWORD))) {
        return json({ error: "Incorrect password." }, 401);
      }
      const token = await createSession(env.VAMSEE_SESSION_SECRET);
      return json({ ok: true }, 200, {
        "Set-Cookie": SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS
      });
    }
    if (url.pathname === "/api/session" && request.method === "GET") {
      if (!env.VAMSEE_SESSION_SECRET || env.VAMSEE_SESSION_SECRET.length < 32) {
        return json({ authenticated: false, configured: false }, 503);
      }
      return json({ authenticated: await validSession(request, env.VAMSEE_SESSION_SECRET), configured: true });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "Request origin rejected." }, 403);
      return json({ ok: true }, 200, {
        "Set-Cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if (!env.VAMSEE_ACCESS_PASSWORD || !env.VAMSEE_SESSION_SECRET || env.VAMSEE_SESSION_SECRET.length < 32) {
      return json({ error: "VAMSEE access controls are not configured." }, 503);
    }
    if (!(await validSession(request, env.VAMSEE_SESSION_SECRET))) {
      return json({ error: "Authentication required." }, 401);
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !sameOrigin(request)) {
      return json({ error: "Request origin rejected." }, 403);
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
Write the customer_reply in professional, natural business English suitable for a logistics company's customer support email. Start with "Hello [customer name]," when a customer name is provided, otherwise "Hello,". Never use intimate, romantic, overly familiar, slang, or pet-name greetings/terms (including "love", "dear", "buddy", or "honey"). Keep the reply concise, empathetic, clear, and action-oriented. Do not claim you checked a carrier system, do not invent shipment scans or delivery facts, do not promise a resolution time, and do not ask for sensitive payment/password information. For damage, ask the customer to preserve packaging and share photos through the verified support channel. For address changes, say eligibility must be checked before promising a change.
Customer name: ${input.customer_name.trim().slice(0,100)}
Tracking/AWB: ${input.tracking_number.trim().slice(0,100) || "Not provided"}
Enquiry type: ${issueLabels[input.issue_type]}
Customer message: ${input.message.trim().slice(0,1500)}
Return only JSON.`;
      try {
        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            { role: "system", content: "You are a logistics support classification engine. Return exactly one JSON object and no other text. Do not include analysis or markdown." },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.1,
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
    if (request.method === "POST" && url.pathname === "/api/escalations/run") {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
      const result = await env.DB.prepare(`UPDATE tickets
        SET assigned_queue = 'Priority Escalations',
            next_action = 'Auto-escalated: HIGH-priority ticket exceeded the 4-hour demo SLA. Review the case and contact the carrier/customer.'
        WHERE priority = 'HIGH'
          AND status IN ('OPEN', 'IN_PROGRESS')
          AND created_at <= ?
          AND assigned_queue != 'Priority Escalations'`)
        .bind(cutoff).run();
      return json({ ok: true, escalated: result.meta.changes || 0, checked_at: now.toISOString() });
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
      let lastTrackingAt = null;
      if (t.last_tracking_at != null && t.last_tracking_at !== "") {
        if (typeof t.last_tracking_at !== "string" || !Number.isFinite(Date.parse(t.last_tracking_at))) {
          return json({ error: "Invalid last tracking movement date." }, 400);
        }
        lastTrackingAt = new Date(t.last_tracking_at).toISOString();
      }
      await env.DB.prepare(`INSERT INTO tickets
        (id, customer_name, tracking_number, issue_type, message, priority, assigned_queue, next_action, status, customer_reply, created_at, updated_at, last_tracking_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`)
        .bind(t.id,t.customer_name,t.tracking_number,t.issue_type,t.message || "",t.priority,t.assigned_queue,t.next_action,t.customer_reply,now,now,lastTrackingAt).run();
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
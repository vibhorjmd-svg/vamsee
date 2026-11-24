import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.split("<script>")[1]?.split("</script>")[0] ?? "";

test("Worker and dashboard JavaScript parse", () => {
  assert.doesNotThrow(() => new Function(worker.replace("export default {", "const worker = {")));
  assert.doesNotThrow(() => new Function(script));
});

test("Individual passwords use salted PBKDF2-HMAC-SHA-256", () => {
  assert.ok(worker.includes("PBKDF2_ITERATIONS=100000"));
  assert.ok(worker.includes("getRandomValues(new Uint8Array(16))"));
  assert.ok(worker.includes('hash:"SHA-256"'));
});

test("User sessions are signed, expiring, and revalidated against active membership", () => {
  assert.ok(worker.includes('crypto.subtle.verify("HMAC"'));
  assert.ok(worker.includes("p.exp>Date.now()/1000"));
  assert.ok(worker.includes("m.status='active' AND o.status='active'"));
});

test("Bootstrap is one-time and concurrent-safe", () => {
  assert.ok(worker.includes("VAMSEE_BOOTSTRAP_TOKEN"));
  assert.ok(worker.includes("WHERE NOT EXISTS (SELECT 1 FROM users)"));
  assert.ok(worker.includes("setup?.[1]?.meta?.changes"));
});

test("User provisioning enforces least-privilege role assignments", () => {
  assert.ok(worker.includes("const roleAssignments="));
  assert.ok(worker.includes("if(!assignable.includes(newRole))"));
  assert.ok(worker.includes("if(!member||!canManage)"));
});

test("Invalid individual sessions cannot fall back to the legacy shared session", () => {
  assert.ok(worker.includes("const legacy=!hasUserCookie&&!member"));
  assert.ok(worker.includes("!hasUserCookie && await validSession"));
});

test("Ticket access is scoped to the authenticated organization", () => {
  assert.ok(worker.includes("const organizationId=member?.organization_id||DEMO_ORG_ID"));
  assert.ok(worker.includes("WHERE organization_id = ?"));
  assert.ok(worker.includes("AND organization_id = ?"));
});

test("Shipment registry and tracking events are tenant-scoped", () => {
  assert.ok(worker.includes("url.pathname===\"/api/shipments\""));
  assert.ok(worker.includes("WHERE organization_id=? ORDER BY updated_at DESC"));
  assert.ok(worker.includes("shipment_events WHERE shipment_id=? AND organization_id=?"));
  assert.ok(worker.includes("Your role cannot add shipment events."));
});

test("Mutating API requests enforce same-origin checks", () => {
  assert.ok(worker.includes('includes(request.method)&&!sameOrigin(request)'));
});


test("AI assistance is restricted to operational roles", () => {
  assert.ok(worker.includes('if (!canOperate) return json({ error: "Your role cannot use AI assistance." }, 403);'));
});


test("Legacy shared-password login is retired", () => {
  assert.ok(worker.includes('Shared-password login is disabled.'));
  assert.ok(worker.includes('if(!member)return json({error:"Authentication required."},401)'));
  assert.ok(!worker.includes("VAMSEE_ACCESS_PASSWORD"));
  assert.ok(html.includes('id="loginEmail" type="email" autocomplete="username" maxlength="254" required'));
  assert.ok(script.includes("fetch('/api/auth/login'"));
  assert.ok(!script.includes("fetch('/api/login'"));
});

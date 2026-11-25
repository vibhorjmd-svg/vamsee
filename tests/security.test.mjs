import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const dashboardHtml = readFileSync(new URL("../public/app.html", import.meta.url), "utf8");
const script = dashboardHtml.split("<script>")[1]?.split("</script>")[0] ?? "";

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

test("Protected APIs require an active individual membership with no legacy fallback", () => {
  assert.ok(worker.includes("if(!member)return json({error:\"Authentication required.\"},401)"));
  assert.ok(worker.includes("const organizationId=member.organization_id, role=member.role"));
  assert.ok(!worker.includes("const legacy=!hasUserCookie&&!member"));
  assert.ok(!worker.includes("VAMSEE_ACCESS_PASSWORD"));
});

test("Ticket access is scoped to the authenticated organization", () => {
  assert.ok(worker.includes("const organizationId=member.organization_id, role=member.role"));
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
  assert.ok(dashboardHtml.includes('id="loginEmail" type="email" autocomplete="username" maxlength="254" required'));
  assert.ok(script.includes("fetch('/api/auth/login'"));
  assert.ok(!script.includes("fetch('/api/login'"));
});


test("CSV shipment imports enforce permissions, row limits, validation, and tenant-scoped upserts", () => {
  assert.ok(worker.includes('url.pathname==="/api/shipments/import"'));
  assert.ok(worker.includes("if(!canOperate)return json({error:\"Your role cannot import shipments.\"},403)"));
  assert.ok(worker.includes("rows.length>200"));
  assert.ok(worker.includes("seen=new Set()"));
  assert.ok(worker.includes("WHERE organization_id=? AND tracking_number=?"));
  assert.ok(worker.includes("await env.DB.batch(statements.slice(i,i+40))"));
  assert.ok(worker.includes("shipments.csv_imported"));
});

test("CSV imports record changed shipment statuses in tracking history", () => {
  assert.ok(worker.includes("const effectiveStatus=(!suppliedStatus&&existing)?existing.current_status:status"));
  assert.ok(worker.includes("const changed=effectiveStatus!==\"unknown\""));
  assert.ok(worker.includes("shipment_events(id,organization_id,shipment_id,event_status,description,event_time,source)"));
  assert.ok(worker.includes("'csv_import'"));
  assert.ok(worker.includes("Shipment status imported from CSV"));
});

test("CSV imports preserve existing status when the optional status column is blank", () => {
  assert.ok(worker.includes('const suppliedStatus=String(row?.current_status??row?.status??"").trim().toLowerCase().replace(/[\\s-]+/g,"_")'));
  assert.ok(worker.includes("current_status=excluded.current_status"));
  assert.ok(worker.includes("const effectiveStatus=(!suppliedStatus&&existing)?existing.current_status:status"));
});


test("CSV import accepts common carrier/status headers and normalizes human-readable statuses", () => {
  assert.ok(worker.includes("row?.carrier_code??row?.carrier??row?.carrier_name"));
  assert.ok(worker.includes("row?.current_status??row?.status??"));
  assert.ok(worker.includes('replace(/[\\s-]+/g,"_")'));
  assert.ok(dashboardHtml.includes('index("carrier")'));
  assert.ok(dashboardHtml.includes('index("status")'));
  assert.ok(dashboardHtml.includes("Status values such as"));
});

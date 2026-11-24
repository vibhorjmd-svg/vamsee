import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\\s\\S]*?)<\\/script>/i)?.[1] ?? "";

test("Worker and dashboard JavaScript parse", () => {
  assert.doesNotThrow(() => new Function(worker.replace("export default {", "const worker = {")));
  assert.doesNotThrow(() => new Function(script));
});

test("Individual passwords use salted PBKDF2-HMAC-SHA-256", () => {
  assert.match(worker, /PBKDF2_ITERATIONS=210000/);
  assert.match(worker, /getRandomValues\\(new Uint8Array\\(16\\)\\)/);
  assert.match(worker, /hash:"SHA-256"/);
});

test("User sessions are signed, expiring, and revalidated against active membership", () => {
  assert.match(worker, /crypto\\.subtle\\.verify\\("HMAC"/);
  assert.match(worker, /p\\.exp>Date\\.now\\(\\)\\/1000/);
  assert.match(worker, /m\\.status='active'.*o\\.status='active'/s);
});

test("Bootstrap is one-time and concurrent-safe", () => {
  assert.match(worker, /VAMSEE_BOOTSTRAP_TOKEN/);
  assert.match(worker, /WHERE NOT EXISTS \\(SELECT 1 FROM users\\)/);
  assert.match(worker, /setup\\?\\.\\[1\\]\\?\\.meta\\?\\.changes/);
});

test("User provisioning enforces least-privilege role assignments", () => {
  assert.match(worker, /const roleAssignments=/);
  assert.match(worker, /if\\(!assignable\\.includes\\(newRole\\)\\)/);
  assert.match(worker, /if\\(!member\\|\\|!canManage\\)/);
});

test("Ticket access is scoped to the authenticated organization", () => {
  assert.match(worker, /const organizationId=member\\?\\.organization_id\\|\\|DEMO_ORG_ID/);
  assert.match(worker, /WHERE organization_id = \\?/);
  assert.match(worker, /AND organization_id = \\?/);
});

test("Mutating API requests enforce same-origin checks", () => {
  assert.match(worker, /includes\\(request\\.method\\)&&!sameOrigin\\(request\\)/);
});

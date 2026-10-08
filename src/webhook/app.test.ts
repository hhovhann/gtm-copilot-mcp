import { afterEach, describe, expect, it, vi } from "vitest";
import { auditActions, count, makeApp, validBody } from "../db/testing.js";
import { assertSecret, secretMatches } from "./auth.js";
import { MAX_BODY_BYTES } from "./app.js";

afterEach(() => vi.restoreAllMocks());

describe("auth", () => {
  it("refuses a missing or short secret at startup", () => {
    expect(() => assertSecret(undefined)).toThrow(/WEBHOOK_SECRET/);
    expect(() => assertSecret("short")).toThrow(/16/);
    expect(assertSecret("x".repeat(16))).toHaveLength(16);
  });
  it("compares secrets exactly", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("abcd", "abc")).toBe(false);
    expect(secretMatches(undefined, "abc")).toBe(false);
  });
});

describe("POST /webhooks/lead", () => {
  it("401 without a secret, and 401 with a wrong one; nothing is stored", async () => {
    const { post, db } = makeApp();
    const missing = await post(validBody(), { "x-webhook-secret": "" });
    const wrong = await post(validBody(), { "x-webhook-secret": "wrong-secret-wrong-secret" });
    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(count(db, "leads")).toBe(0);
    expect(auditActions(db)).toEqual(["unauthorized", "unauthorized"]);
  });
  it("401 when the header is absent entirely", async () => {
    const { app, db } = makeApp();
    const res = await app.request("/webhooks/lead", { method: "POST", body: JSON.stringify(validBody()), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
    expect(JSON.parse((db.prepare("SELECT detail_json FROM audit_log").get() as { detail_json: string }).detail_json)).toEqual({ reason: "missing" });
  });
  it("415 for a non-JSON content type", async () => {
    const { post, db } = makeApp();
    const res = await post("hello", { "content-type": "text/plain" }, true);
    expect(res.status).toBe(415);
    expect(auditActions(db)).toEqual(["payload_rejected"]);
  });
  it("413 for a body over the limit", async () => {
    const { post, db } = makeApp();
    const res = await post(validBody({ message: "x".repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(count(db, "leads")).toBe(0);
  });
  it("400 for invalid JSON", async () => {
    const { post } = makeApp();
    const res = await post("{not json", {}, true);
    expect([res.status, (await res.json()).error]).toEqual([400, "invalid_json"]);
  });
  it("400 lists field paths and echoes no submitted values", async () => {
    const { post, db } = makeApp();
    const res = await post({ email: "ZZMARKER", firstName: "", lastName: "ok", source: "ZZMARKER-source" });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain("ZZMARKER");
    const paths = JSON.parse(text).issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "firstName", "source"]));
    expect(auditActions(db)).toEqual(["payload_rejected"]);
    expect(JSON.stringify(db.prepare("SELECT * FROM audit_log").all())).not.toContain("ZZMARKER");
  });
  it("400 for an invalid Idempotency-Key", async () => {
    const { post } = makeApp();
    expect((await post(validBody(), { "idempotency-key": "k".repeat(201) })).status).toBe(400);
  });

  it("200 stores one lead, one decision and two audit rows", async () => {
    const { post, db } = makeApp();
    const res = await post(validBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: 1, queue: "enterprise_ae", score: 95, duplicate: false });
    expect([count(db, "leads"), count(db, "decisions")]).toEqual([1, 1]);
    expect(auditActions(db)).toEqual(["lead_received", "lead_routed"]);
  });
  it("treats a repeated delivery as a duplicate", async () => {
    const { post, db } = makeApp();
    const first = await (await post(validBody())).json();
    const second = await (await post(validBody({ email: "VP@Orbitbank.example " }))).json();
    expect(second).toEqual({ ...first, duplicate: true });
    expect([count(db, "leads"), count(db, "decisions")]).toEqual([1, 1]);
    expect(auditActions(db)).toEqual(["lead_received", "lead_routed", "duplicate_ignored"]);
  });
  it("uses Idempotency-Key when given", async () => {
    const { post, db } = makeApp();
    const a = await (await post(validBody(), { "idempotency-key": "A" })).json();
    const b = await (await post(validBody(), { "idempotency-key": "B" })).json();
    const aAgain = await (await post(validBody({ message: "different body" }), { "idempotency-key": "A" })).json();
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(b.leadId).not.toBe(a.leadId);
    expect(aAgain).toEqual({ ...a, duplicate: true });
    expect(count(db, "leads")).toBe(2);
  });
  it("returns a generic 500 and stores nothing when processing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { post, db } = makeApp({ enricher: { enrich: async () => { throw new Error("boom with secret detail"); } } });
    const res = await post(validBody());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(count(db, "leads")).toBe(0);
  });
});

describe("privacy", () => {
  it("keeps personal data out of the audit log and the console across a full scenario", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { post, db } = makeApp();
    const body = validBody({ email: "qwerty.person@orbitbank.example", firstName: "Qwertyfirst", lastName: "Qwertylast", message: "SECRETMSG pricing pilot" });
    await post(body);
    await post(body);
    await post({ ...body, source: "nope" });
    await post(body, { "x-webhook-secret": "bad-bad-bad-bad-bad-bad" });
    const audit = JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    for (const needle of ["qwerty", "Qwerty", "SECRETMSG", "@orbitbank"]) expect(audit).not.toContain(needle);
    const logged = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    for (const needle of ["qwerty", "Qwerty", "SECRETMSG"]) expect(logged).not.toContain(needle);
  });
});

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });

  it("routes protected financial lifecycle writes through Hub endpoints", () => {
    expect(manifest.row_policies.periods).toMatchObject({ kind: "endpoint_only", read: "everyone" });
    expect(manifest.row_policies.payments).toMatchObject({ kind: "endpoint_only", read: "everyone" });
    expect(manifest.row_policies.assessments.write_privileged_only).toBe(true);
    expect(manifest.managed_finance).toMatchObject({
      periods_table: "periods",
      payments_table: "payments",
      target_app_id: "reserve-fund",
      target_ledger: "transactions",
    });
    expect(manifest.data_access.writes).toContain("app.reserve-fund.transactions");
  });

  it("stores money as integer cents", () => {
    const migration = readFileSync(join(__dirname, "../migrations/001_init.sql"), "utf-8");
    expect(migration).toContain("amount_due_cents INTEGER");
    expect(migration).toContain("amount_cents INTEGER");
    expect(migration).not.toMatch(/\bREAL\b/);
  });

  // ── Calendar automation suggestions ────────────────────────────────────────
  // The suggestion is the whole delivery mechanism: the household turns it on
  // in settings, and the hub only offers one whose trigger has an installed
  // publisher. A dropped key silently means no calendar entry ever appears.

  it("publishes dues.period_opened under the same adult gate as its siblings", () => {
    expect(manifest.publishes).toContain("dues.period_opened");
    expect(manifest.publish_acls["dues.period_opened"]).toEqual({ require_role: "adult" });
    for (const name of manifest.publishes) {
      expect(manifest.publish_acls[name], `no publish_acl for ${name}`).toEqual({ require_role: "adult" });
    }
  });

  it("every suggested trigger_event is an event this app actually publishes", () => {
    for (const s of manifest.suggested_automations ?? []) {
      expect(manifest.publishes, `unpublished trigger: ${s.trigger_event}`).toContain(s.trigger_event);
    }
  });

  it("every calendar suggestion maps the params create_event requires", () => {
    const creates = (manifest.suggested_automations ?? [])
      .filter(s => s.target_app_id === "calendar" && s.action_id === "create_event");
    expect(creates.length).toBeGreaterThan(0);
    for (const s of creates) {
      // event_date is required by the action; source_ref_id is what keeps one
      // period to one entry, so an edited due date moves it instead of adding
      // a second one and the retraction can find what this made.
      expect(s.param_map.title).toEqual({ kind: "payload_field", value: "review_title" });
      expect(s.param_map.event_date).toEqual({ kind: "payload_field", value: "due_date" });
      expect(s.param_map.description).toEqual({ kind: "payload_field", value: "summary" });
      expect(s.param_map.source_ref_id).toEqual({ kind: "payload_field", value: "source_ref_id" });
    }
  });

  it("ships the retraction half, matched on the same source_ref_id", () => {
    const retract = (manifest.suggested_automations ?? [])
      .find(s => s.target_app_id === "calendar" && s.action_id === "retract_dated_event");
    expect(retract, "no retract_dated_event suggestion").toBeTruthy();
    expect(retract.trigger_event).toBe("dues.period_closed");
    expect(retract.param_map.source_ref_id).toEqual({ kind: "payload_field", value: "source_ref_id" });
  });
});

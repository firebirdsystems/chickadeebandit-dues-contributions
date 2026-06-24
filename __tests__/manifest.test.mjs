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
});

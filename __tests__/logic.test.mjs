import { canManageDues } from "../src/logic.js";
import { testPrivilegedGateContract } from "./helpers/privileged-gate.mjs";

// ── canManageDues ─────────────────────────────────────────────────────────────
// Fronts the write_privileged_only policy gated by board_group_id, so it must
// satisfy the shared privileged-gate contract (mirrors the hub: no adult
// fallback when no board group is configured; dangling group is not privileged).

testPrivilegedGateContract("canManageDues", canManageDues, {
  member:   { id: "a1", role: "adult" },
  outsider: { id: "a3", role: "adult" },
  groups:   [{ id: "g1", memberIds: ["a1", "a2"] }],
  groupId:  "g1",
});

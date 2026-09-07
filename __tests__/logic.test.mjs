import { describe, it, expect } from "vitest";
import {
  canManageDues,
  todayStr,
  safeParse,
  isDuesEligibleMember,
  allocTotal,
  memberDuesStatus,
  periodSourceRefId,
  wantsDueDateEntry,
  dueDateRetractionReason,
  dueDateInputsChanged,
  periodReviewTitle,
  periodDueSummary,
} from "../src/logic.js";
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

// ── todayStr ──────────────────────────────────────────────────────────────────
describe("todayStr", () => {
  it("returns an ISO YYYY-MM-DD date string", () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── safeParse ─────────────────────────────────────────────────────────────────
describe("safeParse", () => {
  it("parses valid JSON", () => {
    expect(safeParse('[1,2]', null)).toEqual([1, 2]);
    expect(safeParse('{"a":1}', null)).toEqual({ a: 1 });
  });
  it("returns the fallback for null, empty, or invalid input", () => {
    expect(safeParse(null, "fb")).toBe("fb");
    expect(safeParse("", "fb")).toBe("fb");
    expect(safeParse(undefined, "fb")).toBe("fb");
    expect(safeParse("{not json", "fb")).toBe("fb");
  });
});

// ── isDuesEligibleMember ──────────────────────────────────────────────────────
// Fixtures are `family.members` rows — { id, name, role, isAdmin?, hasEmail?,
// hasLogin? }. They must NOT carry `email`: the hub never projects it, and
// fixtures that did (the demo-data shape) are precisely what let the old
// `member.email` predicate pass its tests while returning false for every real
// member in production.
describe("isDuesEligibleMember", () => {
  it("accepts an adult the hub reports as having an email on file", () => {
    expect(isDuesEligibleMember({ role: "adult", hasEmail: true })).toBe(true);
  });
  it("rejects children even with an email on file", () => {
    expect(isDuesEligibleMember({ role: "child", hasEmail: true })).toBe(false);
  });
  it("rejects adults with no email on file", () => {
    expect(isDuesEligibleMember({ role: "adult", hasEmail: false })).toBe(false);
    expect(isDuesEligibleMember({ role: "adult" })).toBe(false);
  });
  // Regression: reading `email` is the bug. `family.members` never carries the
  // address, so a predicate that tests it is false for every real member — the
  // roster never renders and closePeriod never warns about unpaid members.
  it("does not read the address: an `email` field alone is not eligibility", () => {
    expect(isDuesEligibleMember({ role: "adult", email: "a@example.com" })).toBe(false);
  });
  it("handles null/undefined members without throwing", () => {
    expect(isDuesEligibleMember(null)).toBe(false);
    expect(isDuesEligibleMember(undefined)).toBe(false);
  });
});

// ── allocTotal ────────────────────────────────────────────────────────────────
describe("allocTotal", () => {
  it("sums basis points and expresses the result as a percent", () => {
    expect(allocTotal([{ basisPoints: 6000 }, { basisPoints: 4000 }])).toBe(100);
    expect(allocTotal([{ basisPoints: 2500 }])).toBe(25);
  });
  it("flags under- and over-allocation (not 100)", () => {
    expect(allocTotal([{ basisPoints: 6000 }, { basisPoints: 3000 }])).toBe(90);
    expect(allocTotal([{ basisPoints: 6000 }, { basisPoints: 5000 }])).toBe(110);
  });
  it("treats missing/absent rules and basis points as zero", () => {
    expect(allocTotal([])).toBe(0);
    expect(allocTotal(undefined)).toBe(0);
    expect(allocTotal([{}, { basisPoints: 5000 }])).toBe(50);
  });
});

// ── memberDuesStatus ──────────────────────────────────────────────────────────
describe("memberDuesStatus", () => {
  const base = { amountDueCents: 20000, dueDate: "2026-05-15", today: "2026-05-10" };

  it("is 'skipped' regardless of payment when the member is excused", () => {
    expect(memberDuesStatus({ ...base, totalPaidCents: 0, skipped: true }))
      .toEqual({ status: "skipped", totalPaid: 0 });
    expect(memberDuesStatus({ ...base, totalPaidCents: 20000, skipped: true }).status).toBe("skipped");
  });

  it("is 'paid' when the total meets or exceeds the amount due", () => {
    expect(memberDuesStatus({ ...base, totalPaidCents: 20000 }).status).toBe("paid");
    expect(memberDuesStatus({ ...base, totalPaidCents: 25000 }).status).toBe("paid");
  });

  it("is 'partial' for an underpayment before the due date", () => {
    expect(memberDuesStatus({ ...base, totalPaidCents: 5000 }).status).toBe("partial");
  });

  it("is 'pending' for no payment before the due date", () => {
    expect(memberDuesStatus({ ...base, totalPaidCents: 0 }).status).toBe("pending");
  });

  it("becomes 'overdue' after the due date for any shortfall", () => {
    const late = { ...base, today: "2026-05-20" };
    expect(memberDuesStatus({ ...late, totalPaidCents: 5000 }).status).toBe("overdue");
    expect(memberDuesStatus({ ...late, totalPaidCents: 0 }).status).toBe("overdue");
    // …but a fully-paid member is never overdue.
    expect(memberDuesStatus({ ...late, totalPaidCents: 20000 }).status).toBe("paid");
  });

  it("is never late when the period has no due date", () => {
    expect(memberDuesStatus({ amountDueCents: 20000, dueDate: null, today: "2999-01-01", totalPaidCents: 0 }).status)
      .toBe("pending");
  });

  it("returns the computed totalPaid alongside the status", () => {
    expect(memberDuesStatus({ ...base, totalPaidCents: 5000 }).totalPaid).toBe(5000);
  });
});

// ── Calendar hand-off ─────────────────────────────────────────────────────────
// The due date is the only thing this app puts on a shared calendar, and the
// mechanism that keeps one period to one entry is the stable source_ref_id.

describe("periodSourceRefId", () => {
  it("is namespaced by app and keyed on the period, so it is stable across publishes", () => {
    expect(periodSourceRefId("p1")).toBe("dues-contributions:p1");
    expect(periodSourceRefId("p1")).toBe(periodSourceRefId("p1"));
    expect(periodSourceRefId("p2")).not.toBe(periodSourceRefId("p1"));
  });
});

describe("wantsDueDateEntry", () => {
  const open = { id: "p1", label: "May 2026", status: "open", dueDate: "2026-05-15" };

  it("wants an entry for an open period with a real yyyy-mm-dd due date", () => {
    expect(wantsDueDateEntry(open)).toBe(true);
  });

  it("refuses a blank or missing due date — an empty event_date fails the run as a missing param", () => {
    expect(wantsDueDateEntry({ ...open, dueDate: "" })).toBe(false);
    expect(wantsDueDateEntry({ ...open, dueDate: null })).toBe(false);
    expect(wantsDueDateEntry({ ...open, dueDate: undefined })).toBe(false);
    expect(wantsDueDateEntry({ ...open, dueDate: "May 15" })).toBe(false);
    expect(wantsDueDateEntry(null)).toBe(false);
  });

  it("refuses a locked period — a closed period's deadline is spent", () => {
    expect(wantsDueDateEntry({ ...open, status: "locked" })).toBe(false);
  });
});

describe("dueDateRetractionReason", () => {
  const open = { id: "p1", label: "May 2026", status: "open", dueDate: "2026-05-15" };

  it("is null while the period still wants an entry, moved date included", () => {
    expect(dueDateRetractionReason(open, open)).toBe(null);
    expect(dueDateRetractionReason(open, { ...open, dueDate: "2026-05-20" })).toBe(null);
  });

  it("is null for a period that never announced — nothing to take down", () => {
    const dateless = { ...open, dueDate: null };
    expect(dueDateRetractionReason(dateless, { ...dateless, label: "Renamed" })).toBe(null);
    expect(dueDateRetractionReason(null, open)).toBe(null);
  });

  it("names the transition out of wanting an entry", () => {
    expect(dueDateRetractionReason(open, { ...open, status: "locked" })).toBe("closed");
    expect(dueDateRetractionReason(open, { ...open, dueDate: "" })).toBe("due_date_cleared");
  });
});

describe("dueDateInputsChanged", () => {
  const open = { id: "p1", label: "May 2026", status: "open", dueDate: "2026-05-15", amountDueCents: 20000 };

  it("is true when the day moves or the period closes", () => {
    expect(dueDateInputsChanged(open, { ...open, dueDate: "2026-05-20" })).toBe(true);
    expect(dueDateInputsChanged(open, { ...open, status: "locked" })).toBe(true);
    expect(dueDateInputsChanged(null, open)).toBe(true);
  });

  it("is false for a cosmetic edit that cannot move the entry", () => {
    expect(dueDateInputsChanged(open, { ...open, label: "May 2026 (rev)" })).toBe(false);
    expect(dueDateInputsChanged(open, { ...open, amountDueCents: 30000 })).toBe(false);
  });
});

describe("periodReviewTitle / periodDueSummary", () => {
  const period = { id: "p1", label: "May 2026", status: "open", dueDate: "2026-05-15", amountDueCents: 20000 };

  it("names the period and nothing else", () => {
    expect(periodReviewTitle(period)).toBe("May 2026 dues due");
  });

  it("never leaks per-member money into the calendar payload", () => {
    // `assessments` is owner_or_visibility and `payments` is endpoint_only, so
    // amounts and balances are not scope-wide readable — and the entry can
    // leave the household entirely through the calendar's ICS feed.
    const text = `${periodReviewTitle(period)} ${periodDueSummary(period)}`;
    expect(text).not.toContain("$");
    expect(text).not.toContain("20000");
    expect(text).not.toContain("200.00");
    expect(text).not.toMatch(/paid|owed|balance|overdue/i);
  });
});

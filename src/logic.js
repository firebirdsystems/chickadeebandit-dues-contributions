// Pure, browser-free logic for dues-contributions, extracted so it can be
// unit-tested. index.html imports from here; tests import from here directly.

/**
 * Whether `me` has Board access — managing periods, assessments, allocations,
 * and recording contributions for others. Mirrors the server-side
 * `write_privileged_only` policy gated by the configured Board group
 * (board_group_id).
 *
 * MUST match the hub's privileged resolution exactly: privileged IFF the board
 * group is configured, still exists, and the member is in it. There is NO "all
 * adults" fallback when the group is unset or dangling — the hub rejects every
 * privileged write in that state, so Board controls stay hidden here too
 * (otherwise every action would be a silent 403). See
 * __tests__/helpers/privileged-gate.mjs.
 *
 * @param {object|null} me
 * @param {Array}  groups
 * @param {string|null} boardGroupId
 */
export function canManageDues(me, groups, boardGroupId) {
  if (!me || !boardGroupId) return false;
  const g = groups.find(g => g.id === boardGroupId);
  return !!g && g.memberIds.includes(me.id);
}

/** Today as an ISO "YYYY-MM-DD" string (UTC), for due-date comparisons. */
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** JSON.parse that never throws — returns `fallback` for null/empty/invalid input. */
export function safeParse(v, fallback) {
  if (v == null || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * Whether a household member is billable for dues: an adult (never a child)
 * with a non-empty email. Mirrors the roster the UI assesses and collects from.
 *
 * @param {object|null} member
 */
export function isDuesEligibleMember(member) {
  return member?.role !== "child"
    && typeof member?.email === "string"
    && member.email.trim().length > 0;
}

/**
 * Total of a period's allocation rules as a percentage: basisPoints/100, summed.
 * A fully-allocated period totals 100; the UI warns when it doesn't.
 *
 * @param {Array<{basisPoints?: number}>} rules
 */
export function allocTotal(rules) {
  return (rules ?? []).reduce((s, r) => s + Number(r.basisPoints || 0), 0) / 100;
}

/**
 * A member's dues status for one period. Pure decision core extracted from the
 * UI so the paid/partial/overdue/pending/skipped branching — and the late-date
 * comparison — is unit-tested rather than living untested inline.
 *
 * `skipped` wins over everything. Otherwise: paid once the total meets the
 * amount due; a partial payment is `overdue` past the due date else `partial`;
 * nothing paid is `overdue` past the due date else `pending`. A period with no
 * due date is never late.
 *
 * @param {object} args
 * @param {number} args.totalPaidCents  sum of the member's posted payments
 * @param {number} args.amountDueCents  the period's per-member amount due
 * @param {string|null} [args.dueDate]  ISO "YYYY-MM-DD", or null for no due date
 * @param {boolean} [args.skipped]      member is excused from this period
 * @param {string} args.today           ISO "YYYY-MM-DD" to compare dueDate against
 * @returns {{status: "skipped"|"paid"|"partial"|"overdue"|"pending", totalPaid: number}}
 */
export function memberDuesStatus({ totalPaidCents, amountDueCents, dueDate, skipped, today }) {
  const totalPaid = Number(totalPaidCents) || 0;
  if (skipped) return { status: "skipped", totalPaid };
  const due = Number(amountDueCents);
  const late = !!dueDate && String(today) > dueDate;
  if (totalPaid >= due) return { status: "paid", totalPaid };
  if (totalPaid > 0)    return { status: late ? "overdue" : "partial", totalPaid };
  return { status: late ? "overdue" : "pending", totalPaid };
}

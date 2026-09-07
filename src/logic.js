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

/**
 * Today as "YYYY-MM-DD" on the DEVICE's calendar — the fallback for Node tests,
 * NOT what the app uses. The browser imports `hubToday` from the hub SDK under
 * this name, so due-date comparisons run on the household's calendar. It used
 * to be UTC, which named yesterday all evening west of Greenwich and showed a
 * payment as overdue a day early.
 */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** JSON.parse that never throws — returns `fallback` for null/empty/invalid input. */
export function safeParse(v, fallback) {
  if (v == null || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * Whether a household member is billable for dues: not a child, and with an
 * email on file.
 *
 * MUST mirror the hub's `eligibleFinanceMembers`, which applies this manifest's
 * own `managed_finance.billable_member_filter` (`exclude_roles: ["child"]`,
 * `require_email: true`) when it closes a period and writes the reconciliation.
 *
 * Read `hasEmail`, never `email`. `family.members` deliberately never projects
 * the address — it is contact PII, stripped by the space directory rules and
 * absent from `toFamilyContextMember` in every tenant. Testing `member.email`
 * (as this did until the hub grew `hasEmail`) made the predicate false for
 * everyone: the billable set was empty in every household, so the Member
 * Payments roster never rendered, the period stats read 0/0 and $0 expected,
 * and — the damaging one — `closePeriod`'s confirmation silently dropped its
 * "N member(s) have not fully paid" warning while the server recorded exactly
 * those members as overdue.
 *
 * @param {object|null} member  a `family.members` row
 */
export function isDuesEligibleMember(member) {
  return member?.role !== "child" && member?.hasEmail === true;
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

// ── Calendar hand-off ────────────────────────────────────────────────────────
// A period's due date is the one date in this app the whole organization needs
// on a shared calendar. Everything else the app knows about money — what a
// member owes, what they have paid, their balance — deliberately stays out of
// the event payload: `assessments` is `owner_or_visibility` and `payments` is
// `endpoint_only`, so per-member money is NOT scope-wide readable, while an
// automation payload lands wherever the household's rule sends it (including an
// external calendar through the ICS feed). Only the period's label and due date
// go out.

/**
 * Steady identity for the calendar entry a period's due date becomes.
 *
 * The event id is fresh on every publish, so it can only ever say "this is a
 * new event", never "this is the same period as last time". Without a stable
 * ref, editing a due date lands a SECOND calendar entry beside the stale first
 * one, and a retraction can never find what it made. Namespaced by app because
 * the key shares a column with every other publisher's.
 *
 * @param {string} periodId
 */
export function periodSourceRefId(periodId) {
  return `dues-contributions:${periodId}`;
}

/**
 * Whether a period should put its due date on the calendar at all.
 *
 * A locked period's deadline is spent — the money is reconciled and the period
 * is closed against edits — and a period with no usable due date has no day to
 * name. The date test is strict on purpose: the calendar's `create_event`
 * requires `event_date`, and an empty string counts as MISSING, so publishing
 * one fails the whole automation run with `missing required param`.
 *
 * @param {{status?: string, dueDate?: string|null}|null} period
 */
export function wantsDueDateEntry(period) {
  if (!period) return false;
  return period.status !== "locked"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(period.dueDate ?? ""));
}

/**
 * Why an edit stopped a period from wanting a calendar entry, or null if it
 * still wants one (or never did).
 *
 * The TRANSITION is what matters, not the end state. Announcing is idempotent
 * — the calendar upserts on source_ref_id — so re-announcing is free, but a
 * retraction published on every save would burn an automation run per typo fix
 * to update zero rows, and rules are rate limited per day. So this returns null
 * unless the period *was* announcing and now is not.
 *
 * @param {object|null} prev
 * @param {object|null} next
 */
export function dueDateRetractionReason(prev, next) {
  if (!prev || !wantsDueDateEntry(prev) || wantsDueDateEntry(next)) return null;
  if (next?.status === "locked") return "closed";
  return "due_date_cleared";
}

/**
 * Whether an edit touched anything the calendar entry is *scheduled* from.
 *
 * Only fields that move the day, or that decide whether there is an entry at
 * all, belong here. `label` deliberately does NOT: it reaches the event as
 * cosmetic text (the review title), and the amount due never reaches it at all.
 * Re-announcing for a renamed period would publish a fresh event for a date
 * that has not moved — an automation run spent to rewrite the same row.
 *
 * @param {object|null} prev
 * @param {object} next
 */
export function dueDateInputsChanged(prev, next) {
  if (!prev) return true;
  return ["dueDate", "status"].some(k => String(prev[k] ?? "") !== String(next[k] ?? ""));
}

/** Title of the calendar entry a due date becomes. Label only — never money. */
export function periodReviewTitle(period) {
  return `${period?.label ?? "Dues"} dues due`;
}

/** Second line of that entry: what the day means, with no per-member figures. */
export function periodDueSummary(period) {
  return `Dues for ${period?.label ?? "this period"} are due. Record contributions in Dues & Contributions.`;
}

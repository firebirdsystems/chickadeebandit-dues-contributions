import { describe, it, expect } from "vitest";
import { paymentFailureLine } from "../src/logic.js";

const err = (props) => Object.assign(new Error("hub text"), props);

describe("paymentFailureLine", () => {
  it("says try again when the read-back failed, whatever the create answered", () => {
    expect(paymentFailureLine(err({ status: 409 }), { readFailed: true })).toBe("Couldn’t record the payment — try again.");
    expect(paymentFailureLine(err({ status: 503 }), { readFailed: true })).toBe("Couldn’t record the payment — try again.");
  });
  it("names a closed period on a 409 whose read-back found nothing", () => {
    expect(paymentFailureLine(err({ status: 409 }))).toBe("This period has been closed, so its payments can’t change.");
  });
  it("names the period, not the payment, as removed on a 404", () => {
    expect(paymentFailureLine(err({ status: 404 }))).toBe("This period has been removed.");
  });
  it("falls back to the shared lines", () => {
    expect(paymentFailureLine(err({ status: 403 }))).toBe("You don’t have permission to record the payment.");
    expect(paymentFailureLine(err({ status: 503 }))).toBe("Couldn’t record the payment — try again.");
  });
});

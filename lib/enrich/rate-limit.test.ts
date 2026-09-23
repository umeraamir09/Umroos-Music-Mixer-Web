import { afterEach, describe, expect, it, vi } from "vitest";
import { createCircuit, createRateLimiter, waitForRetryAfter } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createRateLimiter", () => {
  it("spaces successive calls at the configured interval", async () => {
    vi.useFakeTimers();
    const base = Date.now();
    const wait = createRateLimiter(2); // one call per 500ms
    const marks: number[] = [];
    const runs = [1, 2, 3].map(async () => {
      await wait();
      marks.push(Date.now());
    });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(runs);
    expect(marks.map((mark) => mark - base)).toEqual([0, 500, 1000]);
  });

  it("keeps FIFO order for concurrent callers", async () => {
    vi.useFakeTimers();
    const wait = createRateLimiter(10);
    const order: number[] = [];
    const runs = [0, 1, 2, 3].map(async (index) => {
      await wait();
      order.push(index);
    });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("lets the first caller through immediately", async () => {
    vi.useFakeTimers();
    const wait = createRateLimiter(0.9);
    let done = false;
    const run = wait().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    await run;
  });
});

describe("waitForRetryAfter", () => {
  it("honors the Retry-After header in seconds", async () => {
    vi.useFakeTimers();
    let done = false;
    const run = waitForRetryAfter(new Response(null, { headers: { "Retry-After": "3" } }), 99_999).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(done).toBe(true);
  });

  it("falls back when the header is missing", async () => {
    vi.useFakeTimers();
    const run = waitForRetryAfter(new Response(null), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
  });
});

describe("createCircuit", () => {
  it("opens after repeated failures and only re-arms after the cooldown", () => {
    let now = 0;
    const circuit = createCircuit(2, 1000, () => now);
    circuit.failure();
    expect(() => circuit.check()).not.toThrow();
    circuit.failure();
    expect(() => circuit.check()).toThrow(/circuit open/);
    now = 1001;
    expect(() => circuit.check()).not.toThrow();
    circuit.failure();
    // A failed trial call re-opens the circuit immediately.
    expect(() => circuit.check()).toThrow(/circuit open/);
  });

  it("resets the failure count on success", () => {
    const circuit = createCircuit(2, 1000, () => 0);
    circuit.failure();
    circuit.failure();
    circuit.success();
    expect(() => circuit.check()).not.toThrow();
  });
});

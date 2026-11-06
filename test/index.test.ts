import { describe, expect, it } from "vitest";
import { defineWorkflow, WorkflowError } from "../src/index.js";

type State = "open" | "review" | "closed";
type EventName = "submit" | "approve" | "close" | "reopen" | "touch" | "explode";
interface Ctx {
  allowed: boolean;
}

const T0 = new Date("2024-01-01T00:00:00.000Z");
const T1 = new Date("2024-01-02T00:00:00.000Z");
const T2 = new Date("2024-01-03T00:00:00.000Z");

function build() {
  return defineWorkflow<State, EventName, Ctx>({
    initial: "open",
    states: { open: { label: "Open" }, review: {}, closed: { final: true } },
    transitions: [
      { from: "open", event: "submit", to: "review" },
      { from: ["open", "review"], event: "close", to: "closed" },
      {
        from: "review",
        event: "approve",
        to: "closed",
        guard: (ctx) => ctx.allowed || "approval not permitted",
      },
      { from: "review", event: "reopen", to: "open", guard: (ctx) => ctx.allowed },
      { from: "review", event: "touch", to: "review" },
      {
        from: "open",
        event: "explode",
        to: "review",
        guard: () => {
          throw new Error("boom");
        },
      },
    ],
  });
}

const loop = defineWorkflow<"a" | "b", "touch" | "end">({
  initial: "a",
  states: { a: {}, b: { final: true } },
  transitions: [
    { from: "a", event: "touch", to: "a" },
    { from: "a", event: "end", to: "b" },
  ],
});

function thrown(fn: () => unknown): WorkflowError {
  try {
    fn();
  } catch (error) {
    if (error instanceof WorkflowError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected function to throw");
}

function isDeepFrozen(inst: { history: readonly object[] }): boolean {
  return (
    Object.isFrozen(inst) &&
    Object.isFrozen(inst.history) &&
    inst.history.every((entry) => Object.isFrozen(entry))
  );
}

function bigJson(count: number): string {
  const first = '{"from":null,"to":"a","event":null,"at":"2024-01-01T00:00:00.000Z"}';
  const next = '{"from":"a","to":"a","event":"touch","at":"2024-01-01T00:00:00.000Z"}';
  const parts = [first];
  for (let i = 1; i < count; i += 1) {
    parts.push(next);
  }
  return `{"state":"a","version":${count},"history":[${parts.join(",")}]}`;
}

function issuesOf(def: unknown): string[] {
  const error = thrown(() => defineWorkflow(def as never));
  expect(error.code).toBe("definition");
  return error.issues ?? [];
}

function simple() {
  return {
    initial: "open",
    states: { open: {}, closed: { final: true } },
    transitions: [{ from: "open", event: "close", to: "closed" }],
  };
}

describe("defineWorkflow", () => {
  it("reports the four-defect golden definition in check order", () => {
    const golden = {
      initial: "open",
      states: { open: {}, closed: { final: true }, archived: {} },
      transitions: [
        { from: "open", event: "park", to: "x" },
        { from: "open", event: "close", to: "closed" },
        { from: "open", event: "close", to: "closed" },
        { from: "closed", event: "reopen", to: "open" },
      ],
    };
    expect(issuesOf(golden)).toEqual([
      "transitions[0].to: unknown state 'x'",
      "transitions[2]: duplicate from/event 'open'/'close'",
      "states.archived: unreachable from 'open'",
      "transitions[3]: leaves final state 'closed'",
    ]);
  });

  it("accepts a valid definition", () => {
    expect(() => defineWorkflow(simple() as never)).not.toThrow();
  });

  it("rejects non-object definitions and missing parts", () => {
    expect(issuesOf(null)).toEqual(["definition: must be an object"]);
    expect(issuesOf([])).toEqual(["definition: must be an object"]);
    expect(issuesOf({})).toEqual([
      "initial: must be a string",
      "states: must be an object",
      "transitions: must be an array",
    ]);
  });

  it("enforces the state and transition limits", () => {
    const states: Record<string, object> = {};
    for (let i = 0; i <= 100; i += 1) {
      states[`s${i}`] = {};
    }
    expect(issuesOf({ initial: "s0", states, transitions: [] })).toEqual([
      "states: more than 100 states",
    ]);
    const many = Array.from({ length: 501 }, () => ({
      from: "open",
      event: "close",
      to: "closed",
    }));
    expect(issuesOf({ ...simple(), transitions: many })).toEqual([
      "transitions: more than 500 transitions",
    ]);
  });

  it("accepts exactly 100 states", () => {
    const states: Record<string, object> = {};
    const transitions: object[] = [];
    for (let i = 0; i < 100; i += 1) {
      states[`s${i}`] = {};
      if (i > 0) {
        transitions.push({ from: `s${i - 1}`, event: "next", to: `s${i}` });
      }
    }
    expect(() => defineWorkflow({ initial: "s0", states, transitions } as never)).not.toThrow();
  });

  it("rejects invalid state declarations", () => {
    const bad = {
      initial: "open",
      states: {
        open: {},
        "1bad": {},
        text: 5,
        lab: { label: 5 },
        long: { label: "x".repeat(201) },
        fin: { final: "yes" },
      },
      transitions: [],
    };
    const issues = issuesOf(bad);
    expect(issues).toContain("states.1bad: invalid name");
    expect(issues).toContain("states.text: must be an object");
    expect(issues).toContain("states.lab.label: must be a string of at most 200 characters");
    expect(issues).toContain("states.long.label: must be a string of at most 200 characters");
    expect(issues).toContain("states.fin.final: must be a boolean");
  });

  it("rejects an unknown initial state", () => {
    expect(issuesOf({ ...simple(), initial: "nope" })).toEqual(["initial: unknown state 'nope'"]);
  });

  it("rejects malformed transitions", () => {
    const withTransition = (t: unknown) => issuesOf({ ...simple(), transitions: [t] });
    expect(withTransition(5)).toEqual([
      "transitions[0]: must be an object",
      "states.closed: unreachable from 'open'",
    ]);
    const fromMessage =
      "transitions[0].from: must be a state name or a non-empty list of state names";
    for (const from of [[], 5, [1], Array.from({ length: 101 }, () => "open")]) {
      expect(withTransition({ from, event: "close", to: "closed" })).toContain(fromMessage);
    }
    expect(withTransition({ from: "open", event: "bad event", to: "closed" })).toContain(
      "transitions[0].event: invalid name",
    );
    expect(withTransition({ from: "open", event: 5, to: "closed" })).toContain(
      "transitions[0].event: invalid name",
    );
    expect(withTransition({ from: "open", event: "close", to: 5 })).toContain(
      "transitions[0].to: must be a state name",
    );
    expect(withTransition({ from: "open", event: "close", to: "closed", guard: 5 })).toContain(
      "transitions[0].guard: must be a function",
    );
  });

  it("reports unknown source states and duplicates within one from list", () => {
    const unknownFrom = issuesOf({
      ...simple(),
      transitions: [{ from: "ghost", event: "close", to: "closed" }],
    });
    expect(unknownFrom).toContain("transitions[0].from: unknown state 'ghost'");
    const dup = issuesOf({
      ...simple(),
      transitions: [{ from: ["open", "open"], event: "close", to: "closed" }],
    });
    expect(dup).toEqual(["transitions[0]: duplicate from/event 'open'/'close'"]);
  });

  it("cuts issue strings to 200 characters", () => {
    const issues = issuesOf({ ...simple(), states: { open: {}, [`a${"b".repeat(300)}`]: {} } });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.length).toBeLessThanOrEqual(200);
    }
  });

  it("copies the definition so later edits have no effect", () => {
    const def = simple();
    const wf = defineWorkflow(def as never) as ReturnType<typeof build>;
    def.transitions.length = 0;
    expect(wf.toMermaid()).toContain("s0 --> s1 : close");
  });
});

describe("WorkflowError", () => {
  it("cuts text to 200 characters and keeps details", () => {
    const cause = new Error("inner");
    const error = new WorkflowError("guard_rejected", "m".repeat(500), {
      issues: ["y".repeat(500)],
      state: "open",
      event: "close",
      allowed: ["a"],
      reason: "r".repeat(500),
      expected: 1,
      actual: 2,
      cause,
    });
    expect(error.message.length).toBeLessThanOrEqual(200);
    expect(error.issues?.[0]?.length).toBeLessThanOrEqual(200);
    expect(error.reason?.length).toBeLessThanOrEqual(200);
    expect(error.code).toBe("guard_rejected");
    expect(error.name).toBe("WorkflowError");
    expect(error.state).toBe("open");
    expect(error.event).toBe("close");
    expect(error.allowed).toEqual(["a"]);
    expect(error.expected).toBe(1);
    expect(error.actual).toBe(2);
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(Error);
  });

  it("has no cause or details by default", () => {
    const error = new WorkflowError("too_large", "big");
    expect(error.cause).toBeUndefined();
    expect(error.issues).toBeUndefined();
  });
});

describe("start", () => {
  it("creates a frozen version 1 instance", () => {
    const wf = build();
    const inst = wf.start({ at: T0, actor: "ada" });
    expect(inst.state).toBe("open");
    expect(inst.version).toBe(1);
    expect(inst.history).toEqual([
      { from: null, to: "open", event: null, at: "2024-01-01T00:00:00.000Z", actor: "ada" },
    ]);
    expect(isDeepFrozen(inst)).toBe(true);
  });

  it("omits actor when not given", () => {
    const inst = build().start({ at: T0 });
    expect(Object.keys(inst.history[0] ?? {})).toEqual(["from", "to", "event", "at"]);
  });

  it("rejects invalid dates and oversized actors", () => {
    const wf = build();
    expect(thrown(() => wf.start({ at: new Date(Number.NaN) })).code).toBe("invalid_timestamp");
    expect(thrown(() => wf.start({ at: "2024-01-01" as never })).code).toBe("invalid_timestamp");
    expect(thrown(() => wf.start({ at: T0, actor: "x".repeat(1025) })).code).toBe("too_large");
  });
});

describe("transition", () => {
  it("returns a new frozen instance and leaves the input untouched", () => {
    const wf = build();
    const before = wf.start({ at: T0 });
    const snapshot = structuredClone(before);
    const next = wf.transition(before, "submit", {
      at: T1,
      actor: "bob",
      reason: "ready",
      expectedVersion: 1,
    });
    expect(before).toEqual(snapshot);
    expect(next).not.toBe(before);
    expect(next.state).toBe("review");
    expect(next.version).toBe(2);
    expect(isDeepFrozen(next)).toBe(true);
    expect(next.history.at(-1)).toEqual({
      from: "open",
      to: "review",
      event: "submit",
      at: T1.toISOString(),
      actor: "bob",
      reason: "ready",
    });
  });

  it("supports self transitions, shared events and equal timestamps", () => {
    const wf = build();
    const review = wf.transition(wf.start({ at: T0 }), "submit", { at: T0 });
    const again = wf.transition(review, "touch", { at: T0 });
    expect(again.state).toBe("review");
    expect(again.version).toBe(3);
    const closedFromOpen = wf.transition(wf.start({ at: T0 }), "close", { at: T0 });
    const closedFromReview = wf.transition(review, "close", { at: T0 });
    expect(closedFromOpen.state).toBe("closed");
    expect(closedFromReview.state).toBe("closed");
  });

  it("lets an approved guard pass with its context", () => {
    const wf = build();
    const review = wf.transition(wf.start({ at: T0 }), "submit", { at: T1 });
    const done = wf.transition(review, "approve", { at: T2, context: { allowed: true } });
    expect(done.state).toBe("closed");
  });

  it("throws invalid_transition with the allowed events in definition order", () => {
    const wf = build();
    const inst = wf.start({ at: T0 });
    const error = thrown(() => wf.transition(inst, "approve", { at: T1 }));
    expect(error.code).toBe("invalid_transition");
    expect(error.state).toBe("open");
    expect(error.allowed).toEqual(wf.availableEvents(inst));
    expect(error.allowed).toEqual(["submit", "close", "explode"]);
    expect(thrown(() => wf.transition(inst, 5 as never, { at: T1 })).code).toBe(
      "invalid_transition",
    );
  });

  it("turns guard rejections into guard_rejected and changes nothing", () => {
    const wf = build();
    const review = wf.transition(wf.start({ at: T0 }), "submit", { at: T1 });
    const before = wf.serialize(review);

    const asString = thrown(() =>
      wf.transition(review, "approve", { at: T2, context: { allowed: false } }),
    );
    expect(asString.code).toBe("guard_rejected");
    expect(asString.reason).toBe("approval not permitted");
    expect(asString.state).toBe("review");
    expect(asString.event).toBe("approve");

    const asFalse = thrown(() =>
      wf.transition(review, "reopen", { at: T2, context: { allowed: false } }),
    );
    expect(asFalse.code).toBe("guard_rejected");
    expect(asFalse.reason).toBe("guard returned false");

    const noContext = thrown(() => wf.transition(review, "approve", { at: T2 }));
    expect(noContext.code).toBe("guard_rejected");
    expect(noContext.cause).toBeInstanceOf(TypeError);

    const open = wf.start({ at: T0 });
    const exploded = thrown(() =>
      wf.transition(open, "explode", { at: T1, context: { allowed: true } }),
    );
    expect(exploded.code).toBe("guard_rejected");
    expect(exploded.reason).toBe("guard threw an error");
    expect((exploded.cause as Error).message).toBe("boom");

    expect(wf.serialize(review)).toBe(before);
  });

  it("handles odd guard results and long reasons", () => {
    const make = (guard: unknown) =>
      defineWorkflow<"a" | "b", "go">({
        initial: "a",
        states: { a: {}, b: {} },
        transitions: [{ from: "a", event: "go", to: "b", guard: guard as never }],
      });
    const empty = make(() => "");
    const emptyError = thrown(() => empty.transition(empty.start({ at: T0 }), "go", { at: T0 }));
    expect(emptyError.reason).toBe("guard rejected the transition");
    const odd = make(() => undefined);
    const oddError = thrown(() => odd.transition(odd.start({ at: T0 }), "go", { at: T0 }));
    expect(oddError.reason).toBe("guard returned false");
    const long = make(() => "z".repeat(500));
    const longError = thrown(() => long.transition(long.start({ at: T0 }), "go", { at: T0 }));
    expect(longError.reason?.length).toBeLessThanOrEqual(200);
    expect(longError.message.length).toBeLessThanOrEqual(200);
  });

  it("rejects late events on a terminal state without changing anything", () => {
    const wf = build();
    const open = wf.start({ at: T0 });
    const closed = wf.transition(open, "close", { at: T1 });
    const before = wf.serialize(closed);
    const duplicate = thrown(() => wf.transition(closed, "close", { at: T2 }));
    expect(duplicate.code).toBe("final_state");
    expect(duplicate.state).toBe("closed");
    const stale = thrown(() => wf.transition(closed, "close", { at: T2, expectedVersion: 1 }));
    expect(stale.code).toBe("version_conflict");
    expect(stale.expected).toBe(1);
    expect(stale.actual).toBe(2);
    expect(wf.serialize(closed)).toBe(before);
  });

  it("checks version, timestamp validity and timestamp order", () => {
    const wf = build();
    const inst = wf.start({ at: T1 });
    expect(thrown(() => wf.transition(inst, "submit", { at: T2, expectedVersion: 5 })).code).toBe(
      "version_conflict",
    );
    expect(thrown(() => wf.transition(inst, "submit", { at: new Date(Number.NaN) })).code).toBe(
      "invalid_timestamp",
    );
    expect(thrown(() => wf.transition(inst, "submit", { at: T0 })).code).toBe("invalid_timestamp");
    expect(
      thrown(() => wf.transition(inst, "submit", { at: new Date(Number.NaN), expectedVersion: 9 }))
        .code,
    ).toBe("invalid_timestamp");
  });

  it("refuses to grow the history beyond 10_000 entries", () => {
    const full = loop.restore(bigJson(10_000));
    expect(full.version).toBe(10_000);
    const error = thrown(() => loop.transition(full, "touch", { at: T0 }));
    expect(error.code).toBe("too_large");
  });

  it("limits actor and reason length", () => {
    const wf = build();
    const inst = wf.start({ at: T0 });
    expect(
      thrown(() => wf.transition(inst, "submit", { at: T1, actor: "x".repeat(1025) })).code,
    ).toBe("too_large");
    expect(
      thrown(() => wf.transition(inst, "submit", { at: T1, reason: "x".repeat(1025) })).code,
    ).toBe("too_large");
    const ok = wf.transition(inst, "submit", { at: T1, actor: "x".repeat(1024) });
    expect(ok.version).toBe(2);
  });

  it("rejects values that are not workflow instances", () => {
    const wf = build();
    const bad: unknown[] = [
      null,
      {},
      { state: "open" },
      { state: "nowhere", version: 1, history: [] },
      { state: "open", version: 1, history: [] },
      { state: "open", version: 2, history: [{}] },
      { state: "open", version: 1, history: [{ to: "review", at: T0.toISOString() }] },
      { state: "open", version: 1, history: [{ to: "open", at: "nonsense" }] },
    ];
    for (const value of bad) {
      expect(thrown(() => wf.transition(value as never, "submit", { at: T1 })).code).toBe(
        "corrupt_history",
      );
    }
    expect(thrown(() => wf.can(null as never, "submit")).code).toBe("corrupt_history");
    expect(thrown(() => wf.availableEvents({} as never)).code).toBe("corrupt_history");
    expect(thrown(() => wf.serialize({} as never)).code).toBe("corrupt_history");
  });

  it("accepts hand-made instances without mutating them", () => {
    const wf = build();
    const manual = {
      state: "open" as const,
      version: 1,
      history: [
        { from: null, to: "open" as const, event: null, at: T0.toISOString(), actor: "ada" },
      ],
    };
    const next = wf.transition(manual, "submit", { at: T1 });
    expect(isDeepFrozen(next)).toBe(true);
    expect(Object.isFrozen(manual.history[0])).toBe(false);
    expect(next.history[0]).toEqual(manual.history[0]);
  });
});

describe("can and availableEvents", () => {
  it("lists events in definition order", () => {
    const wf = build();
    const open = wf.start({ at: T0 });
    const review = wf.transition(open, "submit", { at: T1 });
    const closed = wf.transition(review, "close", { at: T2 });
    expect(wf.availableEvents(open)).toEqual(["submit", "close", "explode"]);
    expect(wf.availableEvents(review)).toEqual(["close", "approve", "reopen", "touch"]);
    expect(wf.availableEvents(closed)).toEqual([]);
  });

  it("filters by guards when a context is given", () => {
    const wf = build();
    const open = wf.start({ at: T0 });
    const review = wf.transition(open, "submit", { at: T1 });
    expect(wf.availableEvents(review, { allowed: false })).toEqual(["close", "touch"]);
    expect(wf.availableEvents(review, { allowed: true })).toEqual([
      "close",
      "approve",
      "reopen",
      "touch",
    ]);
    expect(wf.availableEvents(open, { allowed: true })).toEqual(["submit", "close"]);
  });

  it("returns a copy of the event list", () => {
    const wf = build();
    const open = wf.start({ at: T0 });
    wf.availableEvents(open).push("touch");
    expect(wf.availableEvents(open)).toEqual(["submit", "close", "explode"]);
  });

  it("evaluates can with guards", () => {
    const wf = build();
    const open = wf.start({ at: T0 });
    const review = wf.transition(open, "submit", { at: T1 });
    const closed = wf.transition(review, "close", { at: T2 });
    expect(wf.can(open, "submit")).toBe(true);
    expect(wf.can(open, "approve")).toBe(false);
    expect(wf.can(open, "explode", { allowed: true })).toBe(false);
    expect(wf.can(review, "approve", { allowed: true })).toBe(true);
    expect(wf.can(review, "approve", { allowed: false })).toBe(false);
    expect(wf.can(review, "approve")).toBe(false);
    expect(wf.can(closed, "close")).toBe(false);
  });
});

describe("serialize and restore", () => {
  const wf = build();
  const s0 = wf.start({ at: T0, actor: "ada" });
  const s1 = wf.transition(s0, "submit", { at: T1, actor: "bob", reason: "ready" });
  const text = wf.serialize(s1);

  it("serializes with the fixed key order", () => {
    expect(text).toBe(
      '{"state":"review","version":2,"history":[{"from":null,"to":"open","event":null,"at":"2024-01-01T00:00:00.000Z","actor":"ada"},{"from":"open","to":"review","event":"submit","at":"2024-01-02T00:00:00.000Z","actor":"bob","reason":"ready"}]}',
    );
  });

  it("round-trips and returns a frozen instance", () => {
    const back = wf.restore(text);
    expect(wf.serialize(back)).toBe(text);
    expect(back).toEqual(s1);
    expect(isDeepFrozen(back)).toBe(true);
    const closed = wf.transition(back, "close", { at: T2 });
    expect(closed.version).toBe(3);
  });

  it("refuses to serialize more than 1 MiB", () => {
    let inst = loop.start({ at: T0 });
    for (let i = 0; i < 1000; i += 1) {
      inst = loop.transition(inst, "touch", { at: T0, actor: "x".repeat(1024) });
    }
    expect(thrown(() => loop.serialize(inst)).code).toBe("too_large");
  });

  it("throws too_large for 1_048_577 bytes of input", () => {
    expect(thrown(() => wf.restore("a".repeat(1_048_577))).code).toBe("too_large");
    expect(thrown(() => wf.restore("\u20ac".repeat(400_000))).code).toBe("too_large");
    expect(thrown(() => loop.restore(bigJson(10_001))).code).toBe("too_large");
  });

  type Doc = Record<string, unknown> & { history: Array<Record<string, unknown>> };
  const entry = (doc: Doc, index: number): Record<string, unknown> =>
    doc.history[index] as Record<string, unknown>;
  const mutated = (change: (doc: Doc) => void): string => {
    const doc = JSON.parse(text) as Doc;
    change(doc);
    return JSON.stringify(doc);
  };

  const cases: Array<[string, (doc: Doc) => void]> = [
    [
      "an unknown root state",
      (d) => {
        d.state = "nowhere";
      },
    ],
    [
      "a state that differs from the last entry",
      (d) => {
        d.state = "open";
      },
    ],
    [
      "a wrong version",
      (d) => {
        d.version = 3;
      },
    ],
    [
      "a fractional version",
      (d) => {
        d.version = 1.5;
      },
    ],
    [
      "an empty history",
      (d) => {
        d.history = [];
        d.version = 0;
      },
    ],
    [
      "a history that is not an array",
      (d) => {
        (d as { history: unknown }).history = "nope";
      },
    ],
    [
      "a non-string state",
      (d) => {
        d.state = 7;
      },
    ],
    [
      "an extra root field",
      (d) => {
        d.extra = true;
      },
    ],
    [
      "a missing root field",
      (d) => {
        delete d.version;
      },
    ],
    [
      "a start entry with a source state",
      (d) => {
        entry(d, 0).from = "open";
      },
    ],
    [
      "a start entry with an event",
      (d) => {
        entry(d, 0).event = "submit";
      },
    ],
    [
      "a start entry outside the initial state",
      (d) => {
        entry(d, 0).to = "review";
      },
    ],
    [
      "a broken chain",
      (d) => {
        entry(d, 1).from = "review";
      },
    ],
    [
      "a non-string source",
      (d) => {
        entry(d, 1).from = null;
      },
    ],
    [
      "an event that is not defined from the source",
      (d) => {
        entry(d, 1).event = "approve";
      },
    ],
    [
      "a non-string event",
      (d) => {
        entry(d, 1).event = 5;
      },
    ],
    [
      "a wrong target",
      (d) => {
        entry(d, 1).to = "closed";
      },
    ],
    [
      "an unknown target",
      (d) => {
        entry(d, 1).to = "ghost";
      },
    ],
    [
      "a non-string target",
      (d) => {
        entry(d, 1).to = 1;
      },
    ],
    [
      "a decreasing timestamp",
      (d) => {
        entry(d, 1).at = "2023-01-01T00:00:00.000Z";
      },
    ],
    [
      "a non-canonical timestamp",
      (d) => {
        entry(d, 1).at = "2024-01-02";
      },
    ],
    [
      "a non-string timestamp",
      (d) => {
        entry(d, 1).at = 5;
      },
    ],
    [
      "an extra entry field",
      (d) => {
        entry(d, 1).extra = 1;
      },
    ],
    [
      "a missing entry field",
      (d) => {
        delete entry(d, 1).at;
      },
    ],
    [
      "an entry that is not an object",
      (d) => {
        d.history[1] = 5 as never;
      },
    ],
    [
      "a non-string actor",
      (d) => {
        entry(d, 0).actor = 5;
      },
    ],
    [
      "a non-string reason",
      (d) => {
        entry(d, 1).reason = 5;
      },
    ],
    [
      "an oversized actor",
      (d) => {
        entry(d, 0).actor = "x".repeat(1025);
      },
    ],
    [
      "an oversized reason",
      (d) => {
        entry(d, 1).reason = "x".repeat(1025);
      },
    ],
  ];
  for (const [name, change] of cases) {
    it(`rejects ${name} as corrupt_history`, () => {
      expect(thrown(() => wf.restore(mutated(change))).code).toBe("corrupt_history");
    });
  }

  it("rejects malformed JSON and non-object roots", () => {
    for (const input of ["{", "[]", "null", "5", ""]) {
      expect(thrown(() => wf.restore(input)).code).toBe("corrupt_history");
    }
    expect(thrown(() => wf.restore(5 as never)).code).toBe("corrupt_history");
  });

  it("rejects prototype-polluting keys and leaves Object.prototype clean", () => {
    const inputs = [
      '{"__proto__":{"polluted":true},"state":"open","version":1,"history":[]}',
      '{"state":"open","version":1,"history":[],"x":{"constructor":{}}}',
      '{"state":"open","version":1,"history":[{"prototype":1}]}',
      '{"state":"open","version":1,"history":[{"from":null,"to":"open","event":null,"at":"2024-01-01T00:00:00.000Z","__proto__":{"polluted":true}}]}',
    ];
    for (const input of inputs) {
      expect(thrown(() => wf.restore(input)).code).toBe("corrupt_history");
    }
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("accepts event names that look like forbidden keys when they are values", () => {
    const odd = defineWorkflow<"a" | "b", "constructor">({
      initial: "a",
      states: { a: {}, b: {} },
      transitions: [{ from: "a", event: "constructor", to: "b" }],
    });
    const inst = odd.transition(odd.start({ at: T0 }), "constructor", { at: T1 });
    expect(odd.restore(odd.serialize(inst))).toEqual(inst);
  });
});

describe("toMermaid", () => {
  it("renders the documented diagram", () => {
    const wf = defineWorkflow<"open" | "closed", "close">({
      initial: "open",
      states: { open: { label: "Open" }, closed: { final: true } },
      transitions: [{ from: "open", event: "close", to: "closed" }],
    });
    expect(wf.toMermaid()).toBe(
      'stateDiagram-v2\n    state "Open" as s0\n    state "closed" as s1\n    [*] --> s0\n    s0 --> s1 : close\n    s1 --> [*]\n',
    );
  });

  it("renders one line per from state and transition", () => {
    expect(build().toMermaid()).toBe(
      [
        "stateDiagram-v2",
        '    state "Open" as s0',
        '    state "review" as s1',
        '    state "closed" as s2',
        "    [*] --> s0",
        "    s0 --> s1 : submit",
        "    s0 --> s2 : close",
        "    s1 --> s2 : close",
        "    s1 --> s2 : approve",
        "    s1 --> s0 : reopen",
        "    s1 --> s1 : touch",
        "    s0 --> s1 : explode",
        "    s2 --> [*]",
        "",
      ].join("\n"),
    );
  });

  it("replaces double quotes and line breaks in labels", () => {
    const wf = defineWorkflow<"a" | "b", "go">({
      initial: "a",
      states: { a: { label: 'Say "hi"\nnow' }, b: {} },
      transitions: [{ from: "a", event: "go", to: "b" }],
    });
    expect(wf.toMermaid()).toContain("state \"Say 'hi' now\" as s0");
  });
});

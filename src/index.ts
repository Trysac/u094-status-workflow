/**
 * @trysac/status-workflow: a typed status workflow with guarded transitions,
 * an immutable audit history, optimistic versioning and Mermaid export.
 *
 * @packageDocumentation
 */

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_STATES = 100;
const MAX_TRANSITIONS = 500;
const MAX_HISTORY = 10_000;
const MAX_INPUT_BYTES = 1_048_576;
const MAX_MESSAGE = 200;
const MAX_TEXT = 1024;
const MAX_LABEL = 200;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Stable machine-readable codes carried by {@link WorkflowError}. */
export type WorkflowErrorCode =
  | "definition"
  | "invalid_transition"
  | "final_state"
  | "guard_rejected"
  | "version_conflict"
  | "invalid_timestamp"
  | "corrupt_history"
  | "too_large";

/** Optional structured details attached to a {@link WorkflowError}. */
export interface WorkflowErrorDetails {
  /** Definition problems, in check order. */
  issues?: readonly string[];
  /** State involved in the failure. */
  state?: string;
  /** Event involved in the failure. */
  event?: string;
  /** Events that were allowed instead. */
  allowed?: readonly string[];
  /** Guard rejection reason. */
  reason?: string;
  /** Version the caller expected. */
  expected?: number;
  /** Version the instance actually has. */
  actual?: number;
  /** Underlying error, for example an exception thrown by a guard. */
  cause?: unknown;
}

function truncate(text: string, max = MAX_MESSAGE): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * The single error type of this library. Messages, issues and reasons are
 * cut to 200 characters and never contain more than a short excerpt of input.
 */
export class WorkflowError extends Error {
  /** Stable machine-readable error code. */
  readonly code: WorkflowErrorCode;
  /** Definition issues (code `definition`). */
  readonly issues?: string[];
  /** State involved, when relevant. */
  readonly state?: string;
  /** Event involved, when relevant. */
  readonly event?: string;
  /** Events allowed from the state (code `invalid_transition`). */
  readonly allowed?: string[];
  /** Guard rejection reason (code `guard_rejected`). */
  readonly reason?: string;
  /** Expected version (code `version_conflict`). */
  readonly expected?: number;
  /** Actual version (code `version_conflict`). */
  readonly actual?: number;

  /**
   * @param code - Stable error code.
   * @param message - Human readable message, cut to 200 characters.
   * @param details - Optional structured details.
   */
  constructor(code: WorkflowErrorCode, message: string, details: WorkflowErrorDetails = {}) {
    super(truncate(message), "cause" in details ? { cause: details.cause } : undefined);
    this.name = "WorkflowError";
    this.code = code;
    if (details.issues !== undefined) {
      this.issues = details.issues.map((issue) => truncate(issue));
    }
    if (details.state !== undefined) {
      this.state = details.state;
    }
    if (details.event !== undefined) {
      this.event = details.event;
    }
    if (details.allowed !== undefined) {
      this.allowed = [...details.allowed];
    }
    if (details.reason !== undefined) {
      this.reason = truncate(details.reason);
    }
    if (details.expected !== undefined) {
      this.expected = details.expected;
    }
    if (details.actual !== undefined) {
      this.actual = details.actual;
    }
  }
}

/** Static description of one state. */
export interface StateDefinition {
  /** Final states are terminal: no transition may leave them. */
  readonly final?: boolean;
  /** Display label used by {@link Workflow.toMermaid}; defaults to the state name. */
  readonly label?: string;
}

/** Static description of one transition. */
export interface TransitionDefinition<S extends string, E extends string, C> {
  /** Source state or several source states. */
  readonly from: S | readonly S[];
  /** Event name that triggers the transition. */
  readonly event: E;
  /** Target state. */
  readonly to: S;
  /** Optional guard: `true` allows, `false` or a string (the reason) rejects. */
  readonly guard?: (context: C) => boolean | string;
}

/** A complete workflow definition. */
export interface WorkflowDefinition<S extends string, E extends string, C = unknown> {
  /** State every instance starts in. */
  readonly initial: S;
  /** All states in declaration order. */
  readonly states: Record<S, StateDefinition>;
  /** All transitions in definition order. */
  readonly transitions: readonly TransitionDefinition<S, E, C>[];
}

/** One immutable audit record. */
export interface HistoryEntry<S extends string = string, E extends string = string> {
  /** Previous state, `null` for the start entry. */
  readonly from: S | null;
  /** State entered. */
  readonly to: S;
  /** Event applied, `null` for the start entry. */
  readonly event: E | null;
  /** Caller supplied time as an ISO 8601 string. */
  readonly at: string;
  /** Who caused the change. */
  readonly actor?: string;
  /** Why the change happened. */
  readonly reason?: string;
}

/** A deeply frozen workflow instance. */
export interface Instance<S extends string = string, E extends string = string> {
  /** Current state. */
  readonly state: S;
  /** Starts at 1 and grows by one per transition; equals the history length. */
  readonly version: number;
  /** Append-only audit history. */
  readonly history: readonly HistoryEntry<S, E>[];
}

/** Options for {@link Workflow.start}. */
export interface StartOptions {
  /** Time of creation, supplied by the caller. */
  readonly at: Date;
  /** Who created the instance. */
  readonly actor?: string;
}

/** Options for {@link Workflow.transition}. */
export interface TransitionOptions<C = unknown> {
  /** Time of the change, supplied by the caller; must not precede the last entry. */
  readonly at: Date;
  /** Who caused the change. */
  readonly actor?: string;
  /** Why the change happened. */
  readonly reason?: string;
  /** Context passed to the guard. */
  readonly context?: C;
  /** Optimistic concurrency check against `instance.version`. */
  readonly expectedVersion?: number;
}

/** A validated workflow bound to one definition. */
export interface Workflow<S extends string, E extends string, C = unknown> {
  /**
   * Creates a new instance in the initial state with version 1.
   * @throws {WorkflowError} `invalid_timestamp` or `too_large`.
   */
  start(opts: StartOptions): Instance<S, E>;
  /**
   * Applies `event` and returns a new frozen instance; the input is never modified.
   * Checks run in order: timestamp validity, expected version, final state,
   * defined event, timestamp order, history size, guard.
   * @throws {WorkflowError} For every failed check.
   */
  transition(instance: Instance<S, E>, event: E, opts: TransitionOptions<C>): Instance<S, E>;
  /** Returns whether `event` is defined from the state and its guard (run with `context`) allows it. */
  can(instance: Instance<S, E>, event: E, context?: C): boolean;
  /**
   * Events defined from the current state in definition order. Guards are only
   * run when a `context` is passed, in which case rejected events are left out.
   */
  availableEvents(instance: Instance<S, E>, context?: C): E[];
  /** Serializes to JSON with the fixed key order state, version, history. */
  serialize(instance: Instance<S, E>): string;
  /**
   * Rebuilds an instance from JSON produced by {@link Workflow.serialize}. The history is
   * replayed against the definition. Guards are NOT re-run because their context is not stored.
   * @throws {WorkflowError} `too_large` or `corrupt_history`.
   */
  restore(json: string): Instance<S, E>;
  /** Renders the definition as a Mermaid `stateDiagram-v2`. */
  toMermaid(): string;
}

interface CompiledTransition {
  readonly from: readonly string[];
  readonly event: string;
  readonly to: string;
  readonly guard: ((context: unknown) => boolean | string) | undefined;
}

interface CompiledDefinition {
  readonly initial: string;
  readonly states: ReadonlyMap<string, { readonly label: string; readonly final: boolean }>;
  readonly transitions: readonly CompiledTransition[];
}

interface StateEntry {
  readonly final: boolean;
  readonly events: string[];
  readonly byEvent: Map<string, CompiledTransition>;
}

type Verdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly thrown: boolean;
      readonly cause: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definitionError(issues: string[]): WorkflowError {
  const first = issues[0] ?? "unknown problem";
  return new WorkflowError("definition", `invalid workflow definition: ${first}`, { issues });
}

function compileDefinition(def: unknown): CompiledDefinition {
  if (!isRecord(def)) {
    throw definitionError(["definition: must be an object"]);
  }
  const { initial, states, transitions } = def;
  const early: string[] = [];
  if (typeof initial !== "string") {
    early.push("initial: must be a string");
  }
  if (!isRecord(states)) {
    early.push("states: must be an object");
  }
  if (!Array.isArray(transitions)) {
    early.push("transitions: must be an array");
  }
  if (early.length > 0) {
    throw definitionError(early);
  }
  const initialName = initial as string;
  const stateMap = states as Record<string, unknown>;
  const list = transitions as unknown[];
  const stateNames = Object.keys(stateMap);
  if (stateNames.length > MAX_STATES) {
    throw definitionError([`states: more than ${MAX_STATES} states`]);
  }
  if (list.length > MAX_TRANSITIONS) {
    throw definitionError([`transitions: more than ${MAX_TRANSITIONS} transitions`]);
  }

  const issues: string[] = [];
  const info = new Map<string, { label: string; final: boolean }>();
  for (const name of stateNames) {
    if (!NAME_PATTERN.test(name)) {
      issues.push(`states.${name}: invalid name`);
      continue;
    }
    const raw = stateMap[name];
    if (!isRecord(raw)) {
      issues.push(`states.${name}: must be an object`);
      continue;
    }
    let label = name;
    if (raw.label !== undefined) {
      if (typeof raw.label === "string" && raw.label.length <= MAX_LABEL) {
        label = raw.label;
      } else {
        issues.push(`states.${name}.label: must be a string of at most ${MAX_LABEL} characters`);
      }
    }
    if (raw.final !== undefined && typeof raw.final !== "boolean") {
      issues.push(`states.${name}.final: must be a boolean`);
    }
    info.set(name, { label, final: raw.final === true });
  }
  if (!info.has(initialName)) {
    issues.push(`initial: unknown state '${initialName}'`);
  }

  const parsed: Array<CompiledTransition & { readonly index: number }> = [];
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index];
    const where = `transitions[${index}]`;
    if (!isRecord(raw)) {
      issues.push(`${where}: must be an object`);
      continue;
    }
    let ok = true;
    const fromValue: unknown = typeof raw.from === "string" ? [raw.from] : raw.from;
    if (
      !Array.isArray(fromValue) ||
      fromValue.length === 0 ||
      fromValue.length > MAX_STATES ||
      !fromValue.every((item) => typeof item === "string")
    ) {
      issues.push(`${where}.from: must be a state name or a non-empty list of state names`);
      ok = false;
    }
    if (typeof raw.event !== "string" || !NAME_PATTERN.test(raw.event)) {
      issues.push(`${where}.event: invalid name`);
      ok = false;
    }
    if (typeof raw.to !== "string") {
      issues.push(`${where}.to: must be a state name`);
      ok = false;
    }
    if (raw.guard !== undefined && typeof raw.guard !== "function") {
      issues.push(`${where}.guard: must be a function`);
      ok = false;
    }
    if (ok) {
      parsed.push({
        index,
        from: fromValue as string[],
        event: raw.event as string,
        to: raw.to as string,
        guard: raw.guard as CompiledTransition["guard"],
      });
    }
  }

  for (const t of parsed) {
    for (const from of t.from) {
      if (!info.has(from)) {
        issues.push(`transitions[${t.index}].from: unknown state '${from}'`);
      }
    }
    if (!info.has(t.to)) {
      issues.push(`transitions[${t.index}].to: unknown state '${t.to}'`);
    }
  }

  const seenPairs = new Set<string>();
  for (const t of parsed) {
    for (const from of t.from) {
      const key = `${from}/${t.event}`;
      if (seenPairs.has(key)) {
        issues.push(`transitions[${t.index}]: duplicate from/event '${from}'/'${t.event}'`);
      }
      seenPairs.add(key);
    }
  }

  if (info.has(initialName)) {
    const adjacency = new Map<string, string[]>();
    for (const t of parsed) {
      for (const from of t.from) {
        const next = adjacency.get(from) ?? [];
        next.push(t.to);
        adjacency.set(from, next);
      }
    }
    const reached = new Set<string>([initialName]);
    const queue: string[] = [initialName];
    for (const current of queue) {
      for (const next of adjacency.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    for (const name of info.keys()) {
      if (!reached.has(name)) {
        issues.push(`states.${name}: unreachable from '${initialName}'`);
      }
    }
  }

  for (const t of parsed) {
    for (const from of t.from) {
      if (info.get(from)?.final === true) {
        issues.push(`transitions[${t.index}]: leaves final state '${from}'`);
      }
    }
  }

  if (issues.length > 0) {
    throw definitionError(issues);
  }
  return {
    initial: initialName,
    states: info,
    transitions: parsed.map((t) => ({
      from: t.from,
      event: t.event,
      to: t.to,
      guard: t.guard,
    })),
  };
}

function renderMermaid(compiled: CompiledDefinition): string {
  const names = [...compiled.states.keys()];
  const index = new Map(names.map((name, position) => [name, position] as const));
  const id = (name: string): string => `s${index.get(name) as number}`;
  const lines = ["stateDiagram-v2"];
  for (const [name, state] of compiled.states) {
    const label = state.label.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
    lines.push(`    state "${label}" as ${id(name)}`);
  }
  lines.push(`    [*] --> ${id(compiled.initial)}`);
  for (const t of compiled.transitions) {
    for (const from of t.from) {
      lines.push(`    ${id(from)} --> ${id(t.to)} : ${t.event}`);
    }
  }
  for (const [name, state] of compiled.states) {
    if (state.final) {
      lines.push(`    ${id(name)} --> [*]`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function describe(value: unknown): string {
  return typeof value === "string" ? truncate(value, 64) : typeof value;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new WorkflowError("invalid_timestamp", "at must be a valid Date");
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > MAX_TEXT) {
    throw new WorkflowError("too_large", `${field} exceeds ${MAX_TEXT} characters`);
  }
  return value;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length > 40) {
    return undefined;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return new Date(ms).toISOString() === value ? ms : undefined;
}

function makeEntry(
  from: string | null,
  to: string,
  event: string | null,
  at: string,
  actor: string | undefined,
  reason: string | undefined,
): HistoryEntry {
  return Object.freeze({
    from,
    to,
    event,
    at,
    ...(actor === undefined ? {} : { actor }),
    ...(reason === undefined ? {} : { reason }),
  });
}

function freezeInstance(state: string, version: number, history: HistoryEntry[]): Instance {
  return Object.freeze({ state, version, history: Object.freeze(history) });
}

function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function evaluateGuard(guard: CompiledTransition["guard"], context: unknown): Verdict {
  if (guard === undefined) {
    return { ok: true };
  }
  try {
    const result = guard(context);
    if (result === true) {
      return { ok: true };
    }
    if (typeof result === "string") {
      const reason = result === "" ? "guard rejected the transition" : result;
      return { ok: false, reason, thrown: false, cause: undefined };
    }
    return { ok: false, reason: "guard returned false", thrown: false, cause: undefined };
  } catch (error) {
    return { ok: false, reason: "guard threw an error", thrown: true, cause: error };
  }
}

function corrupt(message: string): WorkflowError {
  return new WorkflowError("corrupt_history", message);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw corrupt(`${where}: unexpected field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw corrupt(`${where}: missing field '${key}'`);
    }
  }
}

function reviver(key: string, value: unknown): unknown {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new Error("forbidden key");
  }
  return value;
}

function buildWorkflow(compiled: CompiledDefinition): Workflow<string, string, unknown> {
  const table = new Map<string, StateEntry>();
  for (const [name, info] of compiled.states) {
    table.set(name, { final: info.final, events: [], byEvent: new Map() });
  }
  for (const t of compiled.transitions) {
    for (const from of t.from) {
      const entry = table.get(from) as StateEntry;
      entry.byEvent.set(t.event, t);
      entry.events.push(t.event);
    }
  }
  const mermaid = renderMermaid(compiled);
  const entryOf = (state: string): StateEntry => table.get(state) as StateEntry;

  const checked = (value: unknown): { inst: Instance; lastAt: number } => {
    const bad = corrupt("value is not a valid workflow instance");
    if (!isRecord(value)) {
      throw bad;
    }
    const { state, version, history } = value;
    if (
      typeof state !== "string" ||
      !table.has(state) ||
      !Array.isArray(history) ||
      history.length === 0 ||
      history.length > MAX_HISTORY ||
      version !== history.length
    ) {
      throw bad;
    }
    const last: unknown = history[history.length - 1];
    const lastAt = isRecord(last) ? parseTimestamp(last.at) : undefined;
    if (!isRecord(last) || last.to !== state || lastAt === undefined) {
      throw bad;
    }
    return { inst: value as unknown as Instance, lastAt };
  };

  return Object.freeze({
    start(opts: StartOptions): Instance {
      const at = requireDate(opts.at);
      const actor = optionalText(opts.actor, "actor");
      const entry = makeEntry(null, compiled.initial, null, at.toISOString(), actor, undefined);
      return freezeInstance(compiled.initial, 1, [entry]);
    },

    transition(instance: Instance, event: string, opts: TransitionOptions): Instance {
      const { inst, lastAt } = checked(instance);
      const at = requireDate(opts.at);
      if (opts.expectedVersion !== undefined && opts.expectedVersion !== inst.version) {
        throw new WorkflowError(
          "version_conflict",
          `expected version ${opts.expectedVersion} but instance is at ${inst.version}`,
          { expected: opts.expectedVersion, actual: inst.version },
        );
      }
      const current = entryOf(inst.state);
      if (current.final) {
        throw new WorkflowError("final_state", `state '${inst.state}' is final`, {
          state: inst.state,
        });
      }
      const def = current.byEvent.get(event);
      if (def === undefined) {
        throw new WorkflowError(
          "invalid_transition",
          `event '${describe(event)}' is not defined from state '${inst.state}'`,
          { state: inst.state, allowed: current.events },
        );
      }
      if (at.getTime() < lastAt) {
        throw new WorkflowError("invalid_timestamp", "at is earlier than the last history entry");
      }
      if (inst.history.length >= MAX_HISTORY) {
        throw new WorkflowError("too_large", `history is limited to ${MAX_HISTORY} entries`);
      }
      const actor = optionalText(opts.actor, "actor");
      const reason = optionalText(opts.reason, "reason");
      const verdict = evaluateGuard(def.guard, opts.context);
      if (!verdict.ok) {
        throw new WorkflowError("guard_rejected", `guard rejected '${event}': ${verdict.reason}`, {
          state: inst.state,
          event,
          reason: verdict.reason,
          ...(verdict.thrown ? { cause: verdict.cause } : {}),
        });
      }
      const prior = inst.history.map((item) =>
        Object.isFrozen(item)
          ? item
          : makeEntry(item.from, item.to, item.event, item.at, item.actor, item.reason),
      );
      const entry = makeEntry(inst.state, def.to, event, at.toISOString(), actor, reason);
      return freezeInstance(def.to, inst.version + 1, [...prior, entry]);
    },

    can(instance: Instance, event: string, context?: unknown): boolean {
      const { inst } = checked(instance);
      const def = entryOf(inst.state).byEvent.get(event);
      return def !== undefined && evaluateGuard(def.guard, context).ok;
    },

    availableEvents(instance: Instance, context?: unknown): string[] {
      const { inst } = checked(instance);
      const current = entryOf(inst.state);
      if (context === undefined) {
        return [...current.events];
      }
      return current.events.filter(
        (name) =>
          evaluateGuard((current.byEvent.get(name) as CompiledTransition).guard, context).ok,
      );
    },

    serialize(instance: Instance): string {
      const { inst } = checked(instance);
      const text = JSON.stringify({
        state: inst.state,
        version: inst.version,
        history: inst.history.map((e) => ({
          from: e.from,
          to: e.to,
          event: e.event,
          at: e.at,
          actor: e.actor,
          reason: e.reason,
        })),
      });
      if (utf8Length(text) > MAX_INPUT_BYTES) {
        throw new WorkflowError(
          "too_large",
          `serialized instance exceeds ${MAX_INPUT_BYTES} bytes`,
        );
      }
      return text;
    },

    restore(json: string): Instance {
      if (typeof json !== "string") {
        throw corrupt("input must be a string");
      }
      if (json.length > MAX_INPUT_BYTES || utf8Length(json) > MAX_INPUT_BYTES) {
        throw new WorkflowError("too_large", `input exceeds ${MAX_INPUT_BYTES} bytes`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(json, reviver);
      } catch (error) {
        throw new WorkflowError(
          "corrupt_history",
          "input is not valid JSON or has a forbidden key",
          {
            cause: error,
          },
        );
      }
      if (!isRecord(parsed)) {
        throw corrupt("root must be an object");
      }
      exactKeys(parsed, ["state", "version", "history"], [], "instance");
      const { state, version, history } = parsed;
      if (typeof state !== "string" || !table.has(state)) {
        throw corrupt("state is not defined by the workflow");
      }
      if (!Array.isArray(history) || history.length === 0) {
        throw corrupt("history must be a non-empty array");
      }
      if (history.length > MAX_HISTORY) {
        throw new WorkflowError("too_large", `history is limited to ${MAX_HISTORY} entries`);
      }
      if (version !== history.length) {
        throw corrupt("version must equal the history length");
      }
      const entries: HistoryEntry[] = [];
      let previousTo: string | null = null;
      let previousAt = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < history.length; i += 1) {
        const raw: unknown = history[i];
        const where = `history[${i}]`;
        if (!isRecord(raw)) {
          throw corrupt(`${where}: must be an object`);
        }
        exactKeys(raw, ["from", "to", "event", "at"], ["actor", "reason"], where);
        const { from, to, event, at } = raw;
        if (typeof to !== "string") {
          throw corrupt(`${where}.to: must be a string`);
        }
        if (i === 0) {
          if (from !== null || event !== null || to !== compiled.initial) {
            throw corrupt(`${where}: must record the start in the initial state`);
          }
        } else {
          if (typeof from !== "string" || from !== previousTo || typeof event !== "string") {
            throw corrupt(`${where}: does not continue the previous entry`);
          }
          const edge: CompiledTransition | undefined = table.get(from)?.byEvent.get(event);
          if (edge === undefined || edge.to !== to) {
            throw corrupt(
              `${where}: '${describe(event)}' to '${truncate(to, 64)}' is not a defined transition`,
            );
          }
        }
        const time = parseTimestamp(at);
        if (time === undefined || time < previousAt) {
          throw corrupt(`${where}.at: invalid or out of order timestamp`);
        }
        if (
          (raw.actor !== undefined && typeof raw.actor !== "string") ||
          (raw.reason !== undefined && typeof raw.reason !== "string") ||
          (typeof raw.actor === "string" && raw.actor.length > MAX_TEXT) ||
          (typeof raw.reason === "string" && raw.reason.length > MAX_TEXT)
        ) {
          throw corrupt(
            `${where}: actor and reason must be strings of at most ${MAX_TEXT} characters`,
          );
        }
        entries.push(
          makeEntry(
            i === 0 ? null : (from as string),
            to,
            i === 0 ? null : (event as string),
            at as string,
            raw.actor as string | undefined,
            raw.reason as string | undefined,
          ),
        );
        previousTo = to;
        previousAt = time;
      }
      if (previousTo !== state) {
        throw corrupt("state does not match the last history entry");
      }
      return freezeInstance(state, history.length, entries);
    },

    toMermaid(): string {
      return mermaid;
    },
  });
}

/**
 * Validates `def` and returns a workflow bound to it. The definition is copied,
 * so later changes to the argument have no effect.
 *
 * @param def - Initial state, states and transitions.
 * @returns The workflow.
 * @throws {WorkflowError} `definition` with `issues` when the definition is invalid.
 */
export function defineWorkflow<S extends string, E extends string, C = unknown>(
  def: WorkflowDefinition<S, E, C>,
): Workflow<S, E, C> {
  const compiled = compileDefinition(def);
  return buildWorkflow(compiled) as unknown as Workflow<S, E, C>;
}

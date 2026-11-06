# Workflow guide

`@trysac/status-workflow` keeps the allowed status changes of a business record in one validated definition.

## Define

```ts
import { defineWorkflow } from "@trysac/status-workflow";

const wf = defineWorkflow<"open" | "closed", "close">({
  initial: "open",
  states: { open: { label: "Open" }, closed: { final: true } },
  transitions: [{ from: "open", event: "close", to: "closed" }],
});
```

State and event names match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. At most 100 states and 500 transitions are accepted.
A bad definition throws `WorkflowError` with code `definition` and an `issues` list in this check order:
unknown states, duplicate from/event pairs, states unreachable from the initial state (guards ignored), transitions
that leave a final state.

## Run

- `start({ at, actor? })` creates an instance at version 1.
- `transition(instance, event, { at, actor?, reason?, context?, expectedVersion? })` returns a new deeply frozen
  instance; the input is never modified and a failure changes nothing.
- `can` and `availableEvents` inspect the current state. `availableEvents` runs guards only when a context is passed.
- Time always comes from the caller as a `Date`; it is stored with `toISOString()` and history must not go backwards.

Checks in `transition` run in this order: timestamp validity, `expectedVersion`, final state, event defined from the
state, timestamp order, history size (10 000 entries), guard.

## Persist

`serialize` emits `state`, `version`, `history` in that key order. `restore` accepts at most 1 MiB and 10 000 history
entries, rejects `__proto__`, `constructor` and `prototype` keys and unknown fields, rebuilds the object field by
field and replays the history against the definition. Guards are not re-run on restore because their context is not
stored. Actor and reason are limited to 1024 characters.

## Errors

Every failure is a `WorkflowError` with a stable `code`: `definition`, `invalid_transition`, `final_state`,
`guard_rejected`, `version_conflict`, `invalid_timestamp`, `corrupt_history` or `too_large`. Messages and reasons are
cut to 200 characters.

## Mermaid

`toMermaid()` returns a `stateDiagram-v2` with LF line endings; double quotes in labels become apostrophes.

## Out of scope

Hierarchical or parallel states, timers, side effects, persistence and a CLI. Compared with XState this is a focused
status workflow with an audit history and optimistic concurrency, not a statechart or actor runtime.

# status-workflow

[![npm version](https://img.shields.io/npm/v/@trysac/status-workflow.svg)](https://www.npmjs.com/package/@trysac/status-workflow)
[![license: MIT](https://img.shields.io/npm/l/@trysac/status-workflow.svg)](LICENSE)
[![CI](https://github.com/Trysac/u094-status-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u094-status-workflow/actions/workflows/ci.yml)

Typed configurable state machine for business statuses with guards, immutable audit history, optimistic versioning and Mermaid export

## Problem

Business records such as orders, tickets or requests move through statuses, and the allowed transitions end up scattered in if statements with no audit trail. XState is designed for statecharts and actors, which is more than a status column needs. A small typed workflow definition with validation, guarded transitions, version checks and replayable history keeps the rules in one place.

## Install

```sh
npm install @trysac/status-workflow
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies.

## Usage

```ts
import { defineWorkflow } from "@trysac/status-workflow";

const wf = defineWorkflow<"open" | "closed", "close">({
  initial: "open",
  states: { open: {}, closed: { final: true } },
  transitions: [{ from: "open", event: "close", to: "closed" }],
});
const a = wf.start({ at: new Date() });
const b = wf.transition(a, "close", { at: new Date(), actor: "ada", expectedVersion: 1 });
console.log(b.state, b.version, wf.toMermaid());
```

Guards receive a `context` passed to `transition` or `can`. `restore` replays the stored history against the definition and does not re-run guards, because the guard context is not stored.

## API

| Export | Signature | Description |
|---|---|---|
| `defineWorkflow` | `(def: {initial, states, transitions}) => Workflow` | Validates the definition, copies it and returns a workflow. Throws `WorkflowError` with code `definition` and an `issues` array, checked in order. |
| `WorkflowError` | `class extends Error` | Has `code` and optional `issues`, `state`, `event`, `allowed`, `reason`, `expected`, `actual`. The `cause` property holds the underlying exception when a guard throws. |

Workflow methods:

| Method | Description |
|---|---|
| `start({ at, actor? })` | New deeply frozen instance in the initial state, version 1, with one history entry. |
| `transition(instance, event, { at, actor?, reason?, context?, expectedVersion? })` | Returns a new frozen instance with one appended history entry. The input is never modified. |
| `can(instance, event, context?)` | Whether the event is defined from the current state and its guard allows it. Guards run only when this is called. |
| `availableEvents(instance, context?)` | Events defined from the current state, in definition order. With a context, events whose guards reject are left out. |
| `serialize(instance)` | JSON text with keys `state`, `version`, `history` in that order. |
| `restore(json)` | Parses JSON, validates every field and replays history against the definition. |
| `toMermaid()` | Mermaid `stateDiagram-v2` text. |

Error codes: `definition`, `invalid_transition`, `final_state`, `guard_rejected`, `version_conflict`, `invalid_timestamp`, `corrupt_history`, `too_large`.

`transition` checks run in this order: valid `at`, `expectedVersion`, current state not final, event defined from the state, `at` not earlier than the last entry, history below 10,000 entries, guard.

Limits:

- States and events match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
- At most 100 states and 500 transitions per definition.
- At most 10,000 history entries per instance.
- `restore` input and `serialize` output are at most 1 MiB (1,048,576 bytes of UTF-8).
- `actor` and `reason` are at most 1024 characters.
- Error messages, issues and guard reasons are cut to 200 characters.
- Timestamps are supplied by the caller as `Date` and stored with `toISOString()`.

## Why not XState

XState models statecharts with hierarchical states, parallel regions and actors. This library covers only flat status workflows with guards, version checks and an audit history. It has no hierarchical or parallel states, timers, side effects or persistence.

## Security

The threat model and its limits are described in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez

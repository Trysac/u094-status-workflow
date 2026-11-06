# Project record: status-workflow

## Objective

Provide a typed, configurable state machine for business statuses with guarded transitions, an immutable audit history, optimistic version checks and Mermaid export, so that the allowed status changes of a record are defined in one place and can be replayed from stored JSON.

The intended users are developers who store a status column for records such as orders, tickets or requests and need validation, an audit trail and concurrency checks without a statechart engine.

## Scope

In scope:

- Definition validation with issue reporting (`defineWorkflow`).
- Guarded transitions with final states and append-only history.
- Optimistic concurrency through `expectedVersion`.
- Serialization, validated restore and replay of history against the definition.
- Mermaid `stateDiagram-v2` export of the definition.

Out of scope:

- Hierarchical or parallel states.
- Timers and scheduled transitions.
- Side effects triggered by transitions.
- Persistence to any storage.
- A command-line interface.
- Replacing XState for statecharts and actors.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 331460 / 80317 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.6247 | factory ledger |

## Factory run u094 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2373 | 65512 | 0 | 4473 | 0.3304 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 1029 | 7928 | 41999 | 0.0343 |
| fix-2 | claude-sonnet-5-5 | no | 8 | 622 | 7405 | 58180 | 0.0306 |
| fix-3 | claude-sonnet-5-5 | no | 6 | 770 | 13013 | 49515 | 0.0452 |
| audit | claude-sonnet-5-5 | no | 10 | 3323 | 37105 | 101447 | 0.1362 |
| fix-4 | claude-sonnet-5-5 | no | 6 | 1744 | 7868 | 40273 | 0.0411 |
| docs | claude-haiku-5-5 | no | 33164 | 7317 | 0 | 0 | 0.0070 |

Total: $0.6247. Prices: Anthropic list prices.

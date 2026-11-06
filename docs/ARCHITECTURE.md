# Architecture

## Overview

`@trysac/status-workflow` is a small, dependency-free TypeScript library published to npm as ES modules with type declarations. It is a typed configurable state machine for business statuses with guards, immutable audit history, optimistic versioning and Mermaid export.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Validates definitions, compiles transition tables, applies transitions, serializes and restores instances, and renders Mermaid. Everything consumers import is exported from here. |

The library is a single module. Any new module must be listed in this table and must not be re-exported unless it is part of the public API.

## Boundaries

- No runtime dependencies. The code uses only the Node.js built-in `Buffer` for byte length.
- No I/O at import time. The `Date` values are supplied by the caller; the library never reads the clock.
- Every error is a `WorkflowError` carrying a stable `code`. The library does not throw `TypeError` or `RangeError` for its own checks.
- Instances are deeply frozen. Hand-made instances are accepted and copied, never mutated.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).

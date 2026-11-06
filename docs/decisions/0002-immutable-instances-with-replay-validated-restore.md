# Immutable instances with replay-validated restore

Status: accepted (generated, pending human review)

## Context

Business statuses need guarded transitions, an audit trail and safe concurrent updates, but full statecharts (XState) are more than a status column needs. Instances are persisted as JSON that may come from untrusted storage.

## Decision

Workflows are validated once by defineWorkflow. Instances are deeply frozen values and every transition returns a new instance, with time supplied by the caller and optimistic versioning through expectedVersion. restore parses with a reviver that rejects prototype keys, rebuilds objects field by field and replays the whole history against the definition instead of trusting stored state. Guards run only in transition and can (and in availableEvents when a context is given) and are not re-run on restore. All input sizes are capped and every failure is a WorkflowError with a stable code.

## Consequences

Callers get safe, testable, deterministic behaviour with no hidden clock or I/O. Each transition copies the history, which is O(n) but bounded by the 10 000 entry cap. Guard decisions are not auditable from stored data because the guard context is not persisted. Hierarchical states and side effects remain out of scope.

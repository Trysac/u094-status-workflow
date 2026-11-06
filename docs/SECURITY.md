# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in [../SECURITY.md](../SECURITY.md).

## Threat model

Defended:

- Malformed or tampered serialized input: `restore` checks the exact top-level and entry keys, the state names, the version against the history length, each entry against a defined transition, timestamp order and the final state against `state`. Failures raise `corrupt_history`.
- Prototype pollution through JSON: `restore` uses a JSON reviver that rejects the keys `__proto__`, `constructor` and `prototype`, and rebuilds the instance field by field.
- Oversized input: `restore` rejects input above 1 MiB and histories above 10,000 entries with `too_large`. `serialize` refuses to produce output above the same limit.
- Mutation of shared state: instances are deeply frozen and transitions return new objects.
- Unbounded text: actor and reason are limited to 1024 characters, and error messages, issues and reasons are cut to 200 characters so they carry only short excerpts of input.
- Guard exceptions: a thrown guard error is wrapped as `guard_rejected` with reason `guard threw an error`; the thrown error is kept only as `cause`.

Not defended:

- Forged but valid history: `restore` checks that each entry is a defined transition, not who made it. Anyone who can write the JSON can produce a valid history with any `actor` value. The `actor` field is supplied by the caller and is not authenticated.
- Guard context is not stored and guards are not re-run on `restore`, so a restored instance is not re-checked against current business rules.
- Caller-supplied timestamps are trusted apart from order and validity. The library does not verify wall-clock time.
- Timing and resource limits beyond the stated size caps (for example, CPU cost of a slow guard supplied by the caller) are not controlled.
- Persistence, access control and encryption are out of scope; storage is the caller's responsibility.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The library has no runtime dependencies. Development dependencies are limited to the toolchain listed in [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- The library does not use `eval`, dynamic `Function` construction or shell commands.
- Inputs from callers are validated and rejected with `WorkflowError` codes.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.

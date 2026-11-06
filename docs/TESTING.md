# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suite in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Test files

- `test/index.test.ts` is the only test file. It imports from `../src/index.js` and covers `defineWorkflow`, `WorkflowError`, `start`, `transition`, `can`, `availableEvents`, `serialize`, `restore` and `toMermaid`.
- Definition tests check the golden issue list in check order, state and transition limits (100 states, 500 transitions), malformed declarations, unknown states, duplicate from/event pairs and issue length.
- Transition tests check frozen results, input immutability, guard outcomes (boolean, string, throw), final-state rejection, version conflicts, timestamp checks, the 10,000-entry history limit and actor/reason limits.
- Restore tests check round trips, a list of corrupted inputs that must raise `corrupt_history`, forbidden keys (`__proto__`, `constructor`, `prototype`) and the 1 MiB input limit.
- Mermaid tests check the exact rendered text and label escaping.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Rules

- Coverage thresholds are set in `vitest.config.ts`. Lowering them is not allowed.
- Test through the public entry point (`src/index.ts`) and assert observable behavior: return values, thrown errors and their codes and messages.
- Each bug fix adds a test that fails without the fix.
- Tests use fixed dates and do not use the network or randomness.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.

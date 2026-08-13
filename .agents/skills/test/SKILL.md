---
name: test
description: Write and run a small, high-value set of behavior-focused tests for changed code. Use for critical business logic, public APIs, edge cases, regressions, bug fixes, or focused validation—not exhaustive coverage.
---

# Test

Add the smallest maintainable set of tests that gives strong confidence in the changed behavior. Reuse the repository’s framework, fixtures, helpers, commands, and test boundaries. Do not write production code unless the user explicitly asks to fix a defect exposed by the tests.

## Workflow

1. Read applicable `AGENTS.md` files and inspect the change, nearby implementation, existing tests, public contracts, and available scripts.
2. Identify the highest-risk observable behavior affected by the change.
3. Search existing coverage before creating files; extend the closest relevant test and reuse helpers when clear.
4. Select only cases that can catch a meaningful defect, regression, or compatibility break.
5. Write deterministic behavior-focused tests with concise assertions.
6. Run the narrowest relevant command first; expand only when shared configuration or risk justifies it.
7. Report coverage, exact commands, results, failures, and remaining risk concisely.

## Priorities

Prefer, in order:

- Critical business rules, invariants, calculations, and state transitions.
- Public API inputs, outputs, status codes, errors, and compatibility.
- A regression test that fails for the reported bug before the fix when practical.
- Boundary values, invalid input, authorization, failure recovery, and integration points.
- One representative happy path when it proves the changed contract.

Usually omit framework behavior already tested upstream, private call order, incidental markup, broad snapshots, trivial wrappers/getters, type-only behavior, duplicate happy paths, and combinatorial permutations without distinct risk. Never add tests solely to raise a coverage percentage.

## Choose the boundary

Use the cheapest boundary that verifies observable behavior:

- Unit tests for pure rules, parsing, calculations, and transitions.
- Component/service tests when behavior depends on a framework boundary.
- Integration or contract tests for public APIs, persistence, serialization, middleware, and collaborating layers.
- End-to-end tests only for critical user journeys that lower-level tests cannot establish reliably.

Do not mock the subject under test. Mock or fake only external boundaries that would be slow, nondeterministic, unsafe, or unrelated. Prefer existing repository test doubles over new abstractions.

## Maintainability rules

- Name tests by observable condition and outcome.
- Arrange only the state required for the behavior.
- Assert stable public results, not implementation structure.
- Isolate time, randomness, network, filesystem, database, storage, and global state.
- Use semantic queries and user-visible outcomes for UI tests; use explicit contract assertions for APIs.
- Keep secrets and personal data out of fixtures, snapshots, logs, and failures.
- Avoid arbitrary sleeps, real production services, shared mutable fixtures, over-mocking, and test-only production branches.
- Keep helpers local until repetition makes a shared helper clearer.

## Efficient execution

Discover the package manager and scripts instead of inventing commands. Prefer:

1. One affected test file or test name.
2. The affected package or feature suite.
3. Broader tests only when shared contracts, configuration, or risk require them.

Do not silently update snapshots or golden files; review every expected-output change. If a test fails, distinguish product defect, incorrect expectation, environment/configuration issue, flaky test, and unrelated pre-existing failure. Reproduce narrowly, fix the test only when it is wrong, and never weaken an assertion to hide a real defect.

## Completion report

Report:

- Behaviors covered and why they are high value.
- Test files added or changed.
- Exact commands run and pass/fail counts.
- Concise explanations for failures and whether they are related.
- Important risks intentionally left untested and why.

Do not claim the whole system is verified after running only focused tests.

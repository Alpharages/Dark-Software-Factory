# Test Design

How to turn a feature or flow into concrete test cases like a human QA does.

## Anatomy of a test case

- **ID / name** — short, e.g. "TC-03 Login with wrong password".
- **Precondition** — required state (logged out, account exists, cart has 1 item).
- **Steps** — numbered, atomic actions a person could follow verbatim.
- **Expected result** — the single, observable thing that proves correctness.
- **Actual / Status** — filled in during execution (PASS / FAIL / BLOCKED).

Keep one expected result per case. If you're checking three things, that's three cases (or one case with explicit sub-assertions).

## Coverage techniques

**Equivalence partitioning** — group inputs that should behave the same and test one from each group instead of all. (e.g. for an age field: negative, 0, valid, huge — one each.)

**Boundary value analysis** — bugs cluster at edges. For a field accepting 1–100, test 0, 1, 100, 101. For strings, test empty, 1 char, max length, max+1.

**Negative testing** — deliberately do the wrong thing: blank required fields, invalid email format, expired/declined card, wrong OTP, SQL/HTML-ish input (`'`, `<script>alert(1)</script>`), pasting whitespace, uploading the wrong file type.

**State transitions** — model the flow as states (logged out → logging in → logged in → logged out) and test each transition plus invalid ones (access a logged-in-only page while logged out → should redirect, not error).

**Combinatorial sanity** — when many options interact (filters, toggles), don't test all combinations; test each option once plus a couple of meaningful combinations.

## Prioritization

Test in this order so the most important findings surface first:

1. Happy path of the core flow (does the main thing work at all?).
2. Common error paths users actually hit (wrong password, validation).
3. Boundary and edge inputs.
4. Rare/obscure combinations and cosmetic checks.

## Deriving cases when no spec exists

If the user gives no acceptance criteria, infer expectations from convention and state them:

- Required fields should block submission with a clear message, not a crash.
- Errors should be human-readable and near the offending field.
- Successful actions should give confirmation (toast, redirect, updated state).
- Destructive actions should confirm first.
- The back button and refresh should not corrupt state or double-submit.
- Gated pages should redirect unauthenticated users, not 500.

Write these inferred expectations down in the report so the user can correct any you got wrong.

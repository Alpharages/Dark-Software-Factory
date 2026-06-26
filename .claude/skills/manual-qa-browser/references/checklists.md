# QA Coverage Checklists

Reusable checks by area. Apply the ones relevant to scope; don't treat as exhaustive.

## Forms & input

- [ ] Submit with all fields empty → validation, no crash.
- [ ] Each required field validated individually.
- [ ] Invalid formats rejected (email without @, letters in a number field, bad date).
- [ ] Boundary lengths: empty, min, max, max+1.
- [ ] Special / unicode / emoji / RTL characters accepted or gracefully rejected.
- [ ] Leading/trailing whitespace handled (trimmed or rejected consistently).
- [ ] Paste works, not just typing.
- [ ] Inline error messages are clear and near the field.
- [ ] Successful submit gives confirmation; form doesn't silently no-op.
- [ ] Double-click / rapid resubmit doesn't create duplicates.
- [ ] Disabled/loading state on the submit button during request.
- [ ] Tab order is logical; Enter submits where expected.

## Authentication & authorization

- [ ] Sign up with valid data succeeds.
- [ ] Sign up with existing email → clear "already registered" message.
- [ ] Login with correct credentials succeeds.
- [ ] Login with wrong password fails with a non-revealing message.
- [ ] Login with unknown user fails consistently (no user enumeration).
- [ ] Password reset flow works end to end.
- [ ] Logout actually clears the session (back button doesn't restore it).
- [ ] Gated pages redirect when logged out (not 500, not blank).
- [ ] One user can't access another's data by changing an ID in the URL.
- [ ] Session persists across refresh; expires/logs out as expected.

## Navigation & state

- [ ] All primary nav links go somewhere valid (no 404s).
- [ ] Browser back/forward behaves sanely after key actions.
- [ ] Refresh mid-flow doesn't lose or duplicate data.
- [ ] Deep links / direct URLs to internal pages work.
- [ ] Breadcrumbs / active states reflect the real location.
- [ ] External links open correctly (and as intended re: new tab).

## Content & display

- [ ] No broken images or missing icons.
- [ ] No obvious typos or placeholder text (lorem ipsum, "TODO").
- [ ] Numbers, dates, currencies formatted and localized sensibly.
- [ ] Empty states render (no items in cart, no search results).
- [ ] Long content doesn't overflow or break layout.
- [ ] Loading and error states exist for async content.

## Responsive & cross-viewport

- [ ] Mobile width (~375px): no horizontal scroll, tap targets usable.
- [ ] Tablet and desktop widths render correctly.
- [ ] Menus collapse/expand correctly at breakpoints.
- [ ] Images and tables adapt or scroll deliberately.

## Accessibility (basics)

- [ ] Keyboard-only: can reach and operate every interactive element.
- [ ] Visible focus indicator.
- [ ] Images have alt text; form inputs have labels.
- [ ] Color isn't the only signal for state/errors.
- [ ] Reasonable contrast on text.

## Performance & resilience

- [ ] Pages load in a reasonable time; note anything sluggish.
- [ ] No console errors or failed network requests on normal flows.
- [ ] Behavior under slow/throttled network (loading states, no infinite spinners).
- [ ] Graceful handling when an API call fails (error shown, not a blank page).

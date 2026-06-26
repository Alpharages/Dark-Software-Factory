# Observation & Evidence

A human QA tester sees more than the assertion they're checking. Use these habits.

## Look beyond the immediate check

While running any case, passively watch for:

- **Console errors/warnings** — open devtools console; JS errors often mean a hidden bug even when the UI looks fine.
- **Failed network requests** — 4xx/5xx in the network tab, requests that hang, or unexpected calls.
- **Layout issues** — overlap, misalignment, cut-off text, elements off-screen, broken responsive behavior.
- **Broken assets** — missing images (alt text showing), 404'd stylesheets, missing fonts.
- **Slow or missing feedback** — no spinner during a long request, no confirmation after an action, frozen UI.
- **Copy problems** — typos, placeholder text, unclear error messages, inconsistent terminology.
- **Focus & keyboard** — focus jumping unexpectedly, traps, invisible focus.

## Gathering evidence

For every defect, collect enough that a developer can act without you:

- **Screenshot** at the moment of failure (and one of the steps leading in, if useful).
- **Exact console error text** — copy the message and, if short, the relevant stack frame.
- **Network detail** — request URL, method, status code, and response body for failed calls.
- **Reproduction inputs** — the literal values typed, the account used, the URL.
- **Environment** — browser, viewport/size, URL/environment (prod/staging/local), timestamp.

## Confirming it's real

- Reproduce the issue a second time from a clean state before reporting it.
- Note whether it's **consistent** (every time) or **intermittent** (sometimes) — say which.
- Identify the **minimal** steps that trigger it; strip out unnecessary actions.
- Check whether it's environment-specific (only mobile width? only when logged in?).

## Reading the DOM/console with a driver

When using a scripted driver (Playwright/Selenium/MCP), don't rely on screenshots alone:

- Capture `console` messages and page errors via the driver's event hooks.
- Capture network responses / failed requests.
- Assert on actual DOM state (text content, element presence, attribute/aria values), not just visual appearance.
- Save screenshots to files and reference them in the report.

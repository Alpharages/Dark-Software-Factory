# Running Projects Before QA

How to get an unknown web project running so it can be tested. Goal: a live local URL the browser tool can hit.

## 1. Locate the project

- Working directory and `/mnt/user-data/uploads`. Extract archives (`unzip`, `tar -xf`) into a writable dir.
- If the user named a repo URL, clone it — but only domains on the network allowlist are reachable (github.com, npm, PyPI, etc.).
- Find the project root: the directory containing the manifest (`package.json`, `pyproject.toml`, etc.), not the archive's top wrapper folder.

## 2. Detect type & run command

Inspect files; don't assume.

**Node / JavaScript** — `package.json` present.

- Read `scripts`. Prefer `dev`, then `start`, then `serve`/`preview`.
- Framework hints and typical dev ports:
  - Vite → 5173
  - Create React App → 3000
  - Next.js → 3000
  - Vue CLI → 8080
  - Angular → 4200
  - Express/custom → check the code for `listen(PORT)`
- Install: `npm install` (or `pnpm install` / `yarn` if a matching lockfile exists).
- Run: `npm run dev` (or whichever script). For Vite/CRA you may need `--host` to bind externally.

**Python** —

- Flask: `app.py` with `app.run()` → `flask run` or `python app.py` (default 5000).
- Django: `manage.py` → `python manage.py migrate` then `python manage.py runserver` (default 8000).
- FastAPI: `uvicorn main:app --reload` (default 8000).
- Install: `pip install -r requirements.txt --break-system-packages` (or from `pyproject.toml`).

**Static site** — `index.html` and no build step → `python -m http.server 8000` from that dir.

- If there's a build (`vite`, `webpack`), build first (`npm run build`) then serve the output dir.

**Other** — read the README for the documented run command.

## 3. Install dependencies

Run the install step and watch for failures. A failed install is a finding — capture the error output and report it. Common fixes: matching the lockfile's package manager, Node/Python version mismatches (note them, don't silently work around).

## 4. Start it in the background

The server must keep running while you test. Start it detached and log output:

```bash
nohup npm run dev > /tmp/app.log 2>&1 &
# or
nohup python -m http.server 8000 > /tmp/app.log 2>&1 &
```

Keep the process ID so you can stop it later.

## 5. Confirm it's ready

Don't assume instant startup. Poll until it answers:

```bash
for i in $(seq 1 30); do
  curl -sf http://localhost:PORT >/dev/null && echo READY && break
  sleep 1
done
cat /tmp/app.log   # read actual bound host/port + any startup errors
```

Read the log to find the **real** URL/port the app printed — frameworks often pick a different port if the default is taken. Note any warnings or errors at startup; they frequently point to real bugs.

## 6. Hand off to QA

Record for the report: the run command used, the install result, the base URL, and any startup log warnings. Then begin the QA workflow against that URL.

## 7. Teardown

When finished, stop the background server (kill the PID) so it doesn't linger.

## Failure handling

If the project won't start, report precisely why with the relevant log lines:

- Missing env vars / secrets (no defaults) → list which, ask the user or note as blocked.
- Build error → capture the failing output; this is a Critical finding.
- Unsupported stack or unreachable dependency host → state the limitation.

Never simulate a running app or fabricate QA results when startup failed.

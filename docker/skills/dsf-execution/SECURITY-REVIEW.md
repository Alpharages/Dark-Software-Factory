# dsf-execution SKILL.md — Security Review (NFR-WR6)

**Status:** APPROVED
**Reviewed:** 2026-04-01
**Reviewer:** Khakanali
**Review scope:** docker/skills/dsf-execution/SKILL.md

## Checklist

- [x] No unauthorized network calls — only $REPO_URL host and api.github.com
- [x] No exfiltration paths — output is stdout only (progress + result JSON)
- [x] Explicit prohibition on committing .env files, secrets, and credentials
- [x] No logging of ANTHROPIC_API_KEY, GITHUB_TOKEN, or any env var values
- [x] QA self-healing loop requires actual file edits — dumb retries prohibited
- [x] Final result line is the last stdout output — no trailing sensitive data
- [x] SKILL.md aborts immediately on env var validation failure
- [x] git remote authentication via `gh auth setup-git` — token never embedded in remote URL or `.git/config`

## Notes

- GITHUB_TOKEN is used only for push authentication (remote URL) and gh CLI (GH_TOKEN)
- The token value never appears in git history, commit messages, or PR body
- All env var values are consumed from environment — never echoed or printed
- Network: git clone (REPO_URL host) + git push (REPO_URL host) + gh pr create (api.github.com)

## Production Promotion Gate

This sign-off is required before `dsf-agents:latest` tag is promoted to production.
Re-review required if SKILL.md content changes (any edit to the file resets this gate).

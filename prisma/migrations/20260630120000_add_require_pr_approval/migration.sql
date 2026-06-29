-- Per-project override for the PR-open approval gate.
-- NULL means "inherit the global GITHUB_REQUIRE_PR_APPROVAL setting".
ALTER TABLE "projects" ADD COLUMN "require_pr_approval" BOOLEAN;

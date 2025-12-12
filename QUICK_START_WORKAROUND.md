# Quick Start Workaround - Testing Instructions

## What Was Done

Added fallback repository URL configuration to enable testing without implementing the full Projects table (Story 4.9).

### Changes Made

1. **Updated `.env.example`** - Added `GITHUB_DEFAULT_REPOSITORY`
2. **Updated `env.validation.ts`** - Added validation for `GITHUB_DEFAULT_REPOSITORY` (required)
3. **Updated `clickup-task-update.consumer.ts`** - Reads fallback URL from config when creating tickets

### What You Need to Do

**Add to your `.env` file:**

```bash
# Add this line to .env (replace with your actual repository)
GITHUB_DEFAULT_REPOSITORY=https://github.com/your-org/your-repo
```

**Example:**
```bash
GITHUB_DEFAULT_REPOSITORY=https://github.com/alpharages/dark-software-factory
```

### How It Works

When a ClickUp task arrives:
1. Consumer reads `GITHUB_DEFAULT_REPOSITORY` from config
2. Creates ticket with `project_id = GITHUB_DEFAULT_REPOSITORY`
3. AI execution will clone that repository

### Testing the Complete Flow

**Step 1: Add Repository URL**
```bash
# Edit your .env fileGITHUB_DEFAULT_REPOSITORY=https://github.com/your-org/your-test-repo
```

**Step 2: Restart Application**
```bash
# If app fails to start, you forgot to add GITHUB_DEFAULT_REPOSITORY!
pnpm start:dev
```

**Step 3: Create Test Ticket**
```bash
# The existing test ticket will now have correct repo URL
psql "$DATABASE_URL" -c "UPDATE tickets SET project_id = (SELECT value FROM pg_settings WHERE name = 'GITHUB_DEFAULT_REPOSITORY') WHERE id = 'c6ca86a0-c5ba-43c8-86ce-8aa0be6cbba1';"
```

**Step 4: Trigger AI Execution**
- Execution will now clone your specified repository
- Check logs to verify correct repo is being cloned

### Next Steps

This is a **temporary workaround**. Before Epic 5:
- [ ] Implement Story 4.9 (Projects Table)
- [ ] Migrate to proper project-based repository mapping
- [ ] Remove hardcoded fallback

### Troubleshooting

**App won't start:**
- Error: `GITHUB_DEFAULT_REPOSITORY is required`
- Solution: Add the variable to your `.env` file

**Wrong repo being cloned:**
- Check: `echo $GITHUB_DEFAULT_REPOSITORY`
- Verify it's set correctly in `.env`

**Still using 'clickup-polling':**
- Restart the application
- Config changes require restart

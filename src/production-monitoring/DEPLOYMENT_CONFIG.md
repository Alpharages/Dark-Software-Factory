## System Configuration Validation Warning

⚠️ **IMPORTANT**: Before deploying to production, you **MUST** update the following system configuration values in the database:

### Required Configuration Updates:

1. **DEFAULT_PRODUCTION_ERRORS_LIST_ID**
   - Current seed value: `'901201201201'` (PLACEHOLDER)
   - **Action Required**: Replace with your actual ClickUp List ID for production errors
   - **How to find**: Navigate to your ClickUp list → Settings → Copy List ID

2. **DEFAULT_OPS_ASSIGNEE_ID**
   - Current seed value: `'1234567'` (PLACEHOLDER)
   - **Action Required**: Replace with the numeric ClickUp User ID for your Ops team member
   - **How to find**: ClickUp Profile → Settings → Copy User ID

3. **FRONTEND_URL**
   - Current seed value: `'http://localhost:3001'` (DEV ONLY)
   - **Action Required**: Set to production DSF frontend URL
   - **Example**: `'https://dsf.yourcompany.com'`

### How to Update:

```sql
-- Update via SQL
UPDATE system_configs
SET value = 'YOUR_ACTUAL_LIST_ID'
WHERE key = 'DEFAULT_PRODUCTION_ERRORS_LIST_ID';

UPDATE system_configs
SET value = 'YOUR_ACTUAL_USER_ID'
WHERE key = 'DEFAULT_OPS_ASSIGNEE_ID';

UPDATE system_configs
SET value = 'https://your-dsf-domain.com'
WHERE key = 'FRONTEND_URL';
```

Or update via the System Settings UI in the DSF dashboard.

### What Happens If Not Updated:

- ✅ **Development**: Works fine with placeholder values
- ❌ **Production**: Ticket creation will FAIL with:
  - Invalid ClickUp List ID errors
  - Invalid assignee ID errors
  - Broken deep links to error details

**Status**: Documented for deployment checklist ✅

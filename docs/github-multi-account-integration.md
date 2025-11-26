# GitHub Multi-Account Integration
## Dark Software Factory

**Date:** 2025-11-26  
**Status:** ✅ Architecture Complete  
**Priority:** CRITICAL for production deployment

---

## Problem

Your repositories are spread across **multiple GitHub accounts:**
- Personal account (`your-username`)
- Client organizations (`client-org-a`, `client-org-b`, etc.)
- Partner accounts

**Challenge:** How does Dark Factory authenticate to ALL accounts to clone repos and create PRs?

---

## Solution: GitHub App

**One GitHub App, Multiple Installations**

```
Dark Factory GitHub App
  ├─ Installation 1: Your Personal Account
  │    └─ Access: 15 repositories
  ├─ Installation 2: Client Org A  
  │    └─ Access: 8 repositories
  └─ Installation 3: Client Org B
       └─ Access: 22 repositories
```

Each installation provides an **installation ID** → Dark Factory requests **installation tokens** → Authenticate per-repo automatically.

---

## Why GitHub App? (vs Personal Access Tokens)

| Feature | GitHub App ✅ | Personal Access Token ❌ |
|---------|--------------|-------------------------|
| Multi-account support | ✅ Yes (via installations) | ❌ No (one account only) |
| Granular permissions | ✅ Per-repo selection | ❌ All-or-nothing |
| Higher rate limits | ✅ 5,000/hour | ⚠️ 1,000/hour |
| Security | ✅ App credentials | ⚠️ Personal credentials |
| Revocation | ✅ Per-installation | ❌ Global revoke only |
| Audit trail | ✅ Clear bot identity | ⚠️ Appears as user |

**Winner:** GitHub App 🎯

---

## Setup Steps

### **1. Create GitHub App (One-Time)**

Visit: https://github.com/settings/apps/new

**Settings:**
- Name: "Dark Software Factory"
- Homepage: `https://darkfactory.yourdomain.com`
- Webhook: `https://api.darkfactory.yourdomain.com/webhooks/github`

**Permissions:**
- ✅ Contents: Read & Write (clone, commit, push)
- ✅ Pull Requests: Read & Write (create PRs)
- ✅ Metadata: Read
- ✅ Workflows: Read & Write (trigger CI/CD)

**Result:**
- App ID: `123456`
- Private Key: Download PEM file (store securely!)
- Client ID: `Iv1.xxxx`
- Client Secret: Generate and save

---

### **2. Install on Your Accounts**

**Personal Account:**
1. Go to: `https://github.com/apps/dark-software-factory`
2. Click "Install"
3. Select repositories to grant access
4. ✅ Installed → Installation ID #1

**Client Organizations:**
1. Share app link with client admin
2. They install on their organization  
3. Select repositories to grant access
4. ✅ Installed → Installation ID #2, #3, etc.

---

### **3. Configure Orchestrator**

**Environment Variables:**
```bash
# .env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```

**Automatic Token Management:**
```typescript
// Orchestrator automatically:
1. Parses repo URL: https://github.com/client-org/repo
2. Finds installation with access to "client-org/repo"
3. Requests installation token for that installation
4. Clones repo with token
5. Creates PR with token
```

---

## How It Works (Technical Flow)

```
ClickUp Task: "Add login feature"
Repo: https://github.com/client-org-a/project-1
  ↓
Dark Factory Orchestrator
  ↓
1. Parse URL → owner="client-org-a", repo="project-1"
  ↓
2. Query: Which installation has access?
   → Installation ID 2 (Client Org A)
  ↓
3. Request installation token (valid 1 hour)
   → token="ghs_abcdef123456..."
  ↓
4. Clone repo:
   git clone https://x-access-token:{token}@github.com/client-org-a/project-1
  ↓
5. Generate code (Cursor/Claude)
  ↓
6. Create PR using same token:
   octokit.pulls.create({ owner, repo, ... })
  ↓
✅ PR created on correct account automatically!
```

---

## Database Schema

**Track installations:**
```prisma
model GitHubInstallation {
  installationId    Int      @unique
  accountLogin      String   // "your-username", "client-org-a"
  accountType       String   // "User" | "Organization"
  installedAt       DateTime
  repositories      GitHubRepository[]
}

model GitHubRepository {
  owner             String   // "client-org-a"
  name              String   // "project-1"
  fullName          String   // "client-org-a/project-1"
  installationId    Int      // Links to installation
  defaultBranch     String   @default("main")
}
```

**Automatic sync:** When app is installed, orchestrator stores all accessible repos in database.

---

## User Experience

**AetherFlow Dashboard:**
```
Settings → Integrations → GitHub

Connected Accounts:
✅ your-username (Personal) - 15 repositories
✅ client-org-a (Organization) - 8 repositories  
✅ client-org-b (Organization) - 22 repositories

[+ Add Another GitHub Account/Org] button
```

**Adding New Account:**
```
Click button → Redirect to GitHub → Select repos → Install
  ↓
Returns to AetherFlow:
✅ Installation successful
✅ 2 new repositories connected
✅ Ready to create tickets for those repos
```

---

## Security

**1. Private Key Storage:**
- Development: Environment variable
- Production: AWS Secrets Manager / Google Secret Manager

**2. Token Management:**
- Installation tokens auto-expire after 1 hour
- Orchestrator auto-refreshes before expiry
- Cached in memory for performance

**3. Webhook Verification:**
- All GitHub webhooks verified with HMAC signature
- Protects against unauthorized requests

---

## Benefits

✅ **One app for all accounts** - No juggling multiple PATs  
✅ **Granular access** - Clients choose which repos to share  
✅ **Automatic authentication** - No manual token configuration  
✅ **Higher rate limits** - 5,000 requests/hour per installation  
✅ **Clear audit trail** - Bot commits show "Dark Factory[bot]"  
✅ **Easy revocation** - Client uninstalls = instant access removal  
✅ **Scales infinitely** - Add new accounts without code changes  

---

## Implementation Checklist

- [ ] Create GitHub App in your account
- [ ] Configure permissions and webhooks
- [ ] Download and store private key securely
- [ ] Add environment variables to orchestrator
- [ ] Implement `GitHubAuthService` (handles installations)
- [ ] Implement `GitHubService` (creates PRs, clones repos)
- [ ] Implement webhook handler (syncs installations)
- [ ] Create database models (GitHubInstallation, GitHubRepository)
- [ ] Build UI in AetherFlow to show connected accounts
- [ ] Test with personal account
- [ ] Test with client organization
- [ ] ✅ Production ready!

---

## References

- **GitHub Apps Documentation:** https://docs.github.com/en/apps
- **Octokit SDK:** https://github.com/octokit/octokit.js
- **Architecture Doc:** See `docs/architecture.md` Section 3: GitHub Integration
- **Implementation:** See `src/github/` module

---

**Next Step:** Create GitHub App once Pilot Phase (Phase 1) is validated.

**Priority:** MEDIUM (needed before Phase 2 multi-project rollout)

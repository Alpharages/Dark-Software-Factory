# Story 3.4: Basic Security & Code Quality Checks

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** ready-for-dev  
**Priority:** P1 - HIGH  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwb7`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwb7

---

## Story

As the system,
I want to run security scans on AI-generated code,
So that vulnerabilities and code smells are detected early.

---

## Acceptance Criteria

**Given** AI code is generated  
**When** security checks run  
**Then** the system performs:
- **Dependency vulnerability scanning** (npm audit, pip-audit, go mod verify)
- **Secrets detection** (pattern matching for credentials, API keys)
- **Code complexity analysis** (cyclomatic complexity, function length)
- **Security pattern checking** (SQL injection patterns, XSS vulnerabilities, OWASP Top 10)

**And** security results include:
- Vulnerability severity (critical, high, medium, low)
- Affected dependencies and versions
- Recommended fixes or patches
- Detected secrets (masked in logs per NFR-S4)

**And** if critical vulnerabilities found: QA fails, security report stored, PM notified

---

## Quick Implementation Summary (TL;DR)

**17 Key Files in Implementation Order:**
1. `src/common/sentry/sentry.constants.ts` - ADD `QA_AUTOMATION` to ErrorCategory (if not done)
2. `src/qa-automation/interfaces/security-scanner.interface.ts` - Types
3. `src/qa-automation/interfaces/index.ts` - MODIFY: add exports
4. `src/qa-automation/dto/security-result.dto.ts` - DTOs (follow Story 3.3 pattern)
5. `src/qa-automation/dto/index.ts` - MODIFY: add exports
6. `src/qa-automation/scanners/dependency-scanner.service.ts` - npm audit, pip-audit, go mod
7. `src/qa-automation/scanners/secrets-scanner.service.ts` - Pattern-based secrets detection
8. `src/qa-automation/scanners/complexity-analyzer.service.ts` - ESLint complexity rules
9. `src/qa-automation/scanners/security-pattern.service.ts` - OWASP pattern detection
10. `src/qa-automation/scanners/index.ts` - Barrel export
11. `src/qa-automation/code-review.service.ts` - Main orchestrator (per architecture)
12. `src/common/metrics/metrics.constants.ts` - ADD security metrics to QA_METRICS
13. `src/config/configuration.ts` - Add security config
14. `src/config/env.validation.ts` - Add env var validation
15. `src/qa-automation/qa-automation.module.ts` - Wire providers
16. `src/qa-automation/code-review.service.spec.ts` - Unit tests
17. `test/code-review.e2e-spec.ts` - E2E tests

**No new Prisma models** - Uses existing `QAResult.code_review_passed` and `QAResult.code_review_issues`.

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|---------------|
| Create new metrics object | ADD to existing `QA_METRICS` in `metrics.constants.ts` |
| Log actual secret values | Mask secrets, show only type and location |
| Run external tools without timeout | Use per-scanner configurable timeouts |
| Store raw scan reports | Store normalized, structured results in JSON |
| Hard-code severity thresholds | Use ConfigService for configurable thresholds |
| Skip correlationId | Propagate from caller for audit trail |
| Use `qa-tasks` queue name | Use `qa-check-queue` (from `QUEUE_NAMES` constant) |
| Forget to update QAResult | Update `code_review_passed` and `code_review_issues` |
| Run all scanners sequentially | Run independent scanners in parallel |
| Name service `security-scanner.service.ts` | Use `code-review.service.ts` per architecture.md |
| Scan `node_modules/`, `.git/`, `coverage/` | Use EXCLUDED_PATHS filter |
| Use overly broad secret patterns | Use specific patterns with context validation |

---

## Integration Context

### How This Story Fits in the Pipeline

```
Story 3.3 (Coverage) - coverage analysis complete
    ↓ continues QA pipeline
Story 3.5 (QA Orchestrator) - calls CodeReviewService
    ↓ this story
Story 3.4 (Security Checks) - runs all scanners, saves results
    ↓ if passed
Story 3.5 (Quality Gate) - aggregates all QA results
    ↓ all QA passed
Story 4.x (GitHub Integration) - pushes code
```

### Key Integration Points

| From | Interface | To |
|------|-----------|-----|
| Story 3.5 `QAOrchestratorService` | calls `codeReview.scan({ correlationId })` | This story |
| This story | updates `QAResult.code_review_passed` | Database |
| This story | updates `QAResult.code_review_issues` | Database (JSON) |
| This story | updates `Ticket.status` to `QA_FAILED` | Database |
| This story | creates `AuditLog` entry | Database |
| Story 10.4 | reads results, emits Socket.IO | PM Dashboard |

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/common/sentry/sentry.constants.ts` | MODIFY | ADD `QA_AUTOMATION` to ErrorCategory (if not present) |
| `src/qa-automation/interfaces/security-scanner.interface.ts` | CREATE | Types |
| `src/qa-automation/interfaces/index.ts` | MODIFY | Add exports |
| `src/qa-automation/dto/security-result.dto.ts` | CREATE | DTOs |
| `src/qa-automation/dto/index.ts` | MODIFY | Add exports |
| `src/qa-automation/scanners/dependency-scanner.service.ts` | CREATE | npm audit, pip-audit, go |
| `src/qa-automation/scanners/secrets-scanner.service.ts` | CREATE | Secrets detection |
| `src/qa-automation/scanners/complexity-analyzer.service.ts` | CREATE | Code complexity |
| `src/qa-automation/scanners/security-pattern.service.ts` | CREATE | OWASP patterns |
| `src/qa-automation/scanners/index.ts` | CREATE | Barrel export |
| `src/qa-automation/code-review.service.ts` | CREATE | Main orchestrator |
| `src/common/metrics/metrics.constants.ts` | MODIFY | Add security metrics |
| `src/config/configuration.ts` | MODIFY | Add security config |
| `src/config/env.validation.ts` | MODIFY | Add env var validation |
| `src/qa-automation/qa-automation.module.ts` | MODIFY | Add providers |
| `src/qa-automation/code-review.service.spec.ts` | CREATE | Unit tests |
| `test/code-review.e2e-spec.ts` | CREATE | E2E tests |

---

## Tasks

- [ ] **Task 1: Verify ErrorCategory.QA_AUTOMATION** (CRITICAL)
  - [ ] Verify `QA_AUTOMATION = 'qa_automation'` exists in `sentry.constants.ts`
  - [ ] Add if not present (may have been added by Story 3.3)

- [ ] **Task 2: Create Interfaces** (AC: #1, #2)
  - [ ] `SecuritySeverity`, `SecurityCheckType` enums
  - [ ] `ISecurityVulnerability`, `ISecretFinding`, `IComplexityIssue`, `ISecurityPatternFinding`
  - [ ] `ISecurityScanResult`, `ISecurityScanOptions`
  - [ ] `SECRET_PATTERNS`, `OWASP_PATTERNS`, `EXCLUDED_PATHS` constants

- [ ] **Task 3: Create DTOs** (AC: #2)
  - [ ] Follow DTO pattern from Story 3.3 `CoverageResultDto`
  - [ ] `SecurityVulnerabilityDto`, `SecretFindingDto`, `ComplexityIssueDto`
  - [ ] `SecurityScanResultDto` with validators

- [ ] **Task 4: Implement DependencyScannerService** (AC: #1)
  - [ ] `scanNpm()` - npm audit --json
  - [ ] `scanPip()` - pip-audit --format json
  - [ ] `scanGo()` - go mod verify + govulncheck
  - [ ] Auto-detect language from package files
  - [ ] Handle missing package managers gracefully

- [ ] **Task 5: Implement SecretsScannerService** (AC: #1)
  - [ ] Use SECRET_PATTERNS with context validation
  - [ ] Filter files with EXCLUDED_PATHS and extensions
  - [ ] Mask detected values (first 4 + *** + last 4)
  - [ ] Return file path, line number, pattern type

- [ ] **Task 6: Implement ComplexityAnalyzerService** (AC: #1)
  - [ ] Use ESLint with `eslint-plugin-complexity` rules
  - [ ] Apply severity mapping (>30 CRITICAL, >20 HIGH, >15 MEDIUM)
  - [ ] Check cyclomatic complexity, function length, nesting depth

- [ ] **Task 7: Implement SecurityPatternService** (AC: #1)
  - [ ] Use OWASP_PATTERNS for detection
  - [ ] Return findings with OWASP category and remediation

- [ ] **Task 8: Implement CodeReviewService** (AC: All)
  - [ ] `scan()` - orchestrate all scanners in parallel
  - [ ] Per-scanner timeout support
  - [ ] Aggregate results, determine pass/fail
  - [ ] Propagate correlationId throughout

- [ ] **Task 9: Database Integration** (AC: #3)
  - [ ] `saveResult()` - update `QAResult.code_review_passed`, `code_review_issues`
  - [ ] Create audit log entry
  - [ ] Update `Ticket.status` if critical vulnerabilities

- [ ] **Task 10: Metrics Integration** (AC: #2)
  - [ ] ADD metrics to existing `QA_METRICS`

- [ ] **Task 11: Configuration** (AC: #1)
  - [ ] Add security config with per-scanner timeouts
  - [ ] Update `env.validation.ts`

- [ ] **Task 12: Wire Module + Tests** (AC: All)
  - [ ] Update `QaAutomationModule`
  - [ ] Unit tests with sample outputs
  - [ ] E2E tests

---

## Implementation Guide

### Step 1: Interfaces

**File:** `src/qa-automation/interfaces/security-scanner.interface.ts`

```typescript
export enum SecuritySeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

export enum SecurityCheckType {
  DEPENDENCY = 'dependency',
  SECRET = 'secret',
  COMPLEXITY = 'complexity',
  PATTERN = 'pattern',
}

// Files/directories to exclude from scanning
export const EXCLUDED_PATHS = [
  'node_modules',
  '.git',
  'coverage',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.pytest_cache',
  'vendor',
] as const;

// File extensions to skip in secrets scanning
export const EXCLUDED_EXTENSIONS = [
  '.min.js',
  '.min.css',
  '.map',
  '.lock',
  '.png',
  '.jpg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
] as const;

// Files to skip in secrets scanning (test fixtures, examples)
export const EXCLUDED_FILES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  'secrets.example.json',
] as const;

export interface ISecurityVulnerability {
  checkType: SecurityCheckType.DEPENDENCY;
  severity: SecuritySeverity;
  package: string;
  version: string;
  vulnerableVersions: string;
  patchedVersions?: string;
  title: string;
  description: string;
  cveId?: string;
  recommendation: string;
}

export interface ISecretFinding {
  checkType: SecurityCheckType.SECRET;
  severity: SecuritySeverity;
  filePath: string;
  lineNumber: number;
  secretType: string;
  maskedValue: string; // First 4 + *** + last 4
  recommendation: string;
}

export interface IComplexityIssue {
  checkType: SecurityCheckType.COMPLEXITY;
  severity: SecuritySeverity;
  filePath: string;
  functionName: string;
  lineNumber: number;
  metric: 'cyclomatic' | 'function_length' | 'nesting_depth';
  value: number;
  threshold: number;
  recommendation: string;
}

export interface ISecurityPatternFinding {
  checkType: SecurityCheckType.PATTERN;
  severity: SecuritySeverity;
  filePath: string;
  lineNumber: number;
  patternType: string;
  matchedCode: string;
  owaspCategory: string;
  recommendation: string;
}

export type ISecurityFinding = 
  | ISecurityVulnerability 
  | ISecretFinding 
  | IComplexityIssue 
  | ISecurityPatternFinding;

export interface ISecurityScanResult {
  passed: boolean;
  executionId: string;
  correlationId: string;
  scanDurationMs: number;
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
  };
  vulnerabilities: ISecurityVulnerability[];
  secrets: ISecretFinding[];
  complexityIssues: IComplexityIssue[];
  patternFindings: ISecurityPatternFinding[];
  scannerResults: {
    dependency: { ran: boolean; passed: boolean; durationMs: number; error?: string };
    secrets: { ran: boolean; passed: boolean; durationMs: number; error?: string };
    complexity: { ran: boolean; passed: boolean; durationMs: number; error?: string };
    patterns: { ran: boolean; passed: boolean; durationMs: number; error?: string };
  };
  scannedAt: Date;
}

export interface ISecurityScanOptions {
  workspacePath: string;
  executionId: string;
  correlationId: string;
  projectId: string;
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'auto';
  skipDependencyScan?: boolean;
  skipSecretsScan?: boolean;
  skipComplexityScan?: boolean;
  skipPatternScan?: boolean;
  timeoutMs?: number; // Global timeout, default: 180000
}

// Language auto-detection based on files present
export const LANGUAGE_DETECTION_FILES: Record<string, ISecurityScanOptions['language']> = {
  'package.json': 'typescript', // or javascript, check tsconfig.json
  'tsconfig.json': 'typescript',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'setup.py': 'python',
  'go.mod': 'go',
};

// Complexity thresholds with severity mapping
export const COMPLEXITY_THRESHOLDS = {
  cyclomatic: { critical: 30, high: 20, medium: 15, low: 10 },
  function_length: { critical: 200, high: 100, medium: 75, low: 50 },
  nesting_depth: { critical: 7, high: 5, medium: 4, low: 3 },
} as const;

// Secret patterns with context validation (NFR-S10)
export const SECRET_PATTERNS: { 
  type: string; 
  pattern: RegExp; 
  severity: SecuritySeverity;
  contextValidator?: (match: string, line: string) => boolean;
}[] = [
  { 
    type: 'aws_access_key', 
    pattern: /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:[^A-Z0-9]|$)/g, 
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'aws_secret_key', 
    pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'github_token', 
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g, 
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'github_oauth', 
    pattern: /gho_[A-Za-z0-9]{36}/g, 
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'generic_api_key', 
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']([A-Za-z0-9_\-]{20,})["']/gi, 
    severity: SecuritySeverity.HIGH,
    contextValidator: (match, line) => !line.includes('.env') && !line.includes('process.env'),
  },
  { 
    type: 'generic_secret', 
    pattern: /(?:secret|token)\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi, 
    severity: SecuritySeverity.HIGH,
    contextValidator: (match, line) => !line.includes('example') && !line.includes('placeholder'),
  },
  { 
    type: 'private_key', 
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, 
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'jwt_token', 
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 
    severity: SecuritySeverity.HIGH 
  },
  { 
    type: 'database_url', 
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi, 
    severity: SecuritySeverity.CRITICAL 
  },
  { 
    type: 'slack_webhook', 
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/g, 
    severity: SecuritySeverity.HIGH 
  },
];

// OWASP Top 10 patterns (NFR-S9)
export const OWASP_PATTERNS: { 
  type: string; 
  pattern: RegExp; 
  category: string; 
  severity: SecuritySeverity; 
  recommendation: string;
}[] = [
  {
    type: 'sql_injection_template',
    pattern: /`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|WHERE)/gi,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.CRITICAL,
    recommendation: 'Use parameterized queries or prepared statements',
  },
  {
    type: 'sql_string_concat',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;]*\+\s*(?:req\.|params\.|query\.|body\.|request\.)/gi,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.HIGH,
    recommendation: 'Use parameterized queries instead of string concatenation',
  },
  {
    type: 'xss_innerhtml',
    pattern: /\.innerHTML\s*=\s*(?!['"`])/g,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.HIGH,
    recommendation: 'Use textContent or sanitize HTML before insertion',
  },
  {
    type: 'xss_document_write',
    pattern: /document\.write\s*\(/g,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.HIGH,
    recommendation: 'Avoid document.write, use DOM methods instead',
  },
  {
    type: 'command_injection',
    pattern: /(?:exec|spawn|execSync|spawnSync|execFile)\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/g,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.CRITICAL,
    recommendation: 'Sanitize user input before shell execution or use shell: false',
  },
  {
    type: 'eval_usage',
    pattern: /\beval\s*\([^)]*(?:\$|req\.|params\.|query\.|body\.)/g,
    category: 'A03:2021-Injection',
    severity: SecuritySeverity.CRITICAL,
    recommendation: 'Never use eval() with user input',
  },
  {
    type: 'path_traversal',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream|unlink|rmdir)\s*\([^)]*(?:\+|`\$\{)/g,
    category: 'A01:2021-Broken Access Control',
    severity: SecuritySeverity.HIGH,
    recommendation: 'Validate and sanitize file paths, use path.resolve with whitelist',
  },
  {
    type: 'hardcoded_credentials',
    pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*["'][^"']{8,}["']/gi,
    category: 'A07:2021-Identification and Authentication Failures',
    severity: SecuritySeverity.HIGH,
    recommendation: 'Use environment variables for credentials',
  },
  {
    type: 'insecure_random',
    pattern: /Math\.random\s*\(\)/g,
    category: 'A02:2021-Cryptographic Failures',
    severity: SecuritySeverity.MEDIUM,
    recommendation: 'Use crypto.randomBytes() for security-sensitive randomness',
  },
];
```

---

### Step 2: DTOs

**File:** `src/qa-automation/dto/security-result.dto.ts`

Follow pattern from Story 3.3's `coverage-result.dto.ts`. Key DTOs:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsString, IsArray, IsEnum, IsOptional, ValidateNested, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { SecuritySeverity, SecurityCheckType } from '../interfaces';

// Follow same pattern as CoverageDataDto, CoverageDeltaDto, CoverageAnalysisDto
// Create: SecurityVulnerabilityDto, SecretFindingDto, ComplexityIssueDto, 
//         SecurityPatternFindingDto, SecurityScanSummaryDto, SecurityScanResultDto
```

---

### Step 3: Dependency Scanner Service

**File:** `src/qa-automation/scanners/dependency-scanner.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ISecurityVulnerability, SecuritySeverity, SecurityCheckType, LANGUAGE_DETECTION_FILES } from '../interfaces';

const execAsync = promisify(exec);

// Sample output for testing
export const NPM_AUDIT_SAMPLE_OUTPUT = JSON.stringify({
  vulnerabilities: {
    'lodash': {
      severity: 'high',
      via: [{ title: 'Prototype Pollution', url: 'https://npmjs.com/advisories/1523' }],
      effects: [],
      range: '<4.17.21',
      fixAvailable: { name: 'lodash', version: '4.17.21' },
    },
  },
  metadata: { vulnerabilities: { high: 1, moderate: 0, low: 0 } },
});

@Injectable()
export class DependencyScannerService {
  private readonly logger = new Logger(DependencyScannerService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.dependencyScanTimeoutMs', 60000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecurityVulnerability[]> {
    const language = await this.detectLanguage(workspacePath);
    this.logger.debug(`[${correlationId}] Detected language: ${language}`);

    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.scanNpm(workspacePath, correlationId);
      case 'python':
        return this.scanPip(workspacePath, correlationId);
      case 'go':
        return this.scanGo(workspacePath, correlationId);
      default:
        this.logger.warn(`[${correlationId}] No dependency scanner for language: ${language}`);
        return [];
    }
  }

  private async detectLanguage(workspacePath: string): Promise<string> {
    for (const [file, lang] of Object.entries(LANGUAGE_DETECTION_FILES)) {
      try {
        await fs.access(path.join(workspacePath, file));
        return lang!;
      } catch { /* file not found */ }
    }
    return 'unknown';
  }

  private async scanNpm(workspacePath: string, correlationId: string): Promise<ISecurityVulnerability[]> {
    try {
      // npm audit returns non-zero exit code if vulnerabilities found
      const { stdout } = await execAsync('npm audit --json', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch(e => ({ stdout: e.stdout || '{}' }));

      const audit = JSON.parse(stdout);
      return this.parseNpmAudit(audit, correlationId);
    } catch (error) {
      this.logger.error(`[${correlationId}] npm audit failed: ${(error as Error).message}`);
      return [];
    }
  }

  private parseNpmAudit(audit: any, correlationId: string): ISecurityVulnerability[] {
    const vulnerabilities: ISecurityVulnerability[] = [];
    
    for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities || {})) {
      const v = vuln as any;
      vulnerabilities.push({
        checkType: SecurityCheckType.DEPENDENCY,
        severity: this.mapNpmSeverity(v.severity),
        package: pkgName,
        version: v.range || 'unknown',
        vulnerableVersions: v.range || '*',
        patchedVersions: v.fixAvailable?.version,
        title: v.via?.[0]?.title || `Vulnerability in ${pkgName}`,
        description: v.via?.[0]?.url || '',
        cveId: v.via?.[0]?.cve,
        recommendation: v.fixAvailable ? `Upgrade to ${v.fixAvailable.version}` : 'Review and replace package',
      });
    }
    
    this.logger.debug(`[${correlationId}] Found ${vulnerabilities.length} npm vulnerabilities`);
    return vulnerabilities;
  }

  private async scanPip(workspacePath: string, correlationId: string): Promise<ISecurityVulnerability[]> {
    try {
      const { stdout } = await execAsync('pip-audit --format json', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch(e => ({ stdout: e.stdout || '[]' }));

      const findings = JSON.parse(stdout);
      return findings.map((f: any) => ({
        checkType: SecurityCheckType.DEPENDENCY,
        severity: this.mapPipSeverity(f.vulnerability?.severity),
        package: f.name,
        version: f.version,
        vulnerableVersions: f.vulnerability?.affected_versions || '*',
        patchedVersions: f.vulnerability?.fixed_versions?.[0],
        title: f.vulnerability?.id || `Vulnerability in ${f.name}`,
        description: f.vulnerability?.description || '',
        cveId: f.vulnerability?.aliases?.[0],
        recommendation: f.vulnerability?.fixed_versions?.[0] 
          ? `Upgrade to ${f.vulnerability.fixed_versions[0]}` 
          : 'Review and replace package',
      }));
    } catch (error) {
      this.logger.warn(`[${correlationId}] pip-audit not available or failed`);
      return [];
    }
  }

  private async scanGo(workspacePath: string, correlationId: string): Promise<ISecurityVulnerability[]> {
    try {
      // First verify go.sum integrity
      await execAsync('go mod verify', { cwd: workspacePath, timeout: this.timeoutMs });
      
      // Use govulncheck if available
      const { stdout } = await execAsync('govulncheck -json ./...', {
        cwd: workspacePath,
        timeout: this.timeoutMs,
      }).catch(() => ({ stdout: '{}' }));

      // Parse govulncheck output
      const findings: ISecurityVulnerability[] = [];
      // ... parse JSON output
      return findings;
    } catch (error) {
      this.logger.warn(`[${correlationId}] Go vulnerability scan failed`);
      return [];
    }
  }

  private mapNpmSeverity(severity: string): SecuritySeverity {
    switch (severity?.toLowerCase()) {
      case 'critical': return SecuritySeverity.CRITICAL;
      case 'high': return SecuritySeverity.HIGH;
      case 'moderate': return SecuritySeverity.MEDIUM;
      case 'low': return SecuritySeverity.LOW;
      default: return SecuritySeverity.INFO;
    }
  }

  private mapPipSeverity(severity: string): SecuritySeverity {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return SecuritySeverity.CRITICAL;
      case 'HIGH': return SecuritySeverity.HIGH;
      case 'MEDIUM': return SecuritySeverity.MEDIUM;
      case 'LOW': return SecuritySeverity.LOW;
      default: return SecuritySeverity.INFO;
    }
  }
}
```

---

### Step 4: Secrets Scanner Service

**File:** `src/qa-automation/scanners/secrets-scanner.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  ISecretFinding, 
  SecurityCheckType, 
  SECRET_PATTERNS, 
  EXCLUDED_PATHS, 
  EXCLUDED_EXTENSIONS,
  EXCLUDED_FILES,
} from '../interfaces';

@Injectable()
export class SecretsScannerService {
  private readonly logger = new Logger(SecretsScannerService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.secretsScanTimeoutMs', 30000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecretFinding[]> {
    const findings: ISecretFinding[] = [];
    const files = await this.getSourceFiles(workspacePath);
    
    this.logger.debug(`[${correlationId}] Scanning ${files.length} files for secrets`);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          
          for (const pattern of SECRET_PATTERNS) {
            const matches = line.matchAll(pattern.pattern);
            
            for (const match of matches) {
              // Apply context validator if defined
              if (pattern.contextValidator && !pattern.contextValidator(match[0], line)) {
                continue;
              }

              findings.push({
                checkType: SecurityCheckType.SECRET,
                severity: pattern.severity,
                filePath: path.relative(workspacePath, filePath),
                lineNumber: lineNum + 1,
                secretType: pattern.type,
                maskedValue: this.maskSecret(match[0]),
                recommendation: `Remove ${pattern.type} from source code. Use environment variables instead.`,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(`[${correlationId}] Could not scan ${filePath}: ${(error as Error).message}`);
      }
    }

    this.logger.debug(`[${correlationId}] Found ${findings.length} potential secrets`);
    return findings;
  }

  private async getSourceFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip excluded directories
        if (entry.isDirectory()) {
          if (!EXCLUDED_PATHS.includes(entry.name as any)) {
            await walk(fullPath);
          }
          continue;
        }

        // Skip excluded files and extensions
        if (EXCLUDED_FILES.includes(entry.name as any)) continue;
        if (EXCLUDED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) continue;

        files.push(fullPath);
      }
    };

    await walk(dirPath);
    return files;
  }

  private maskSecret(value: string): string {
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }
}
```

---

### Step 5: Complexity Analyzer Service

**File:** `src/qa-automation/scanners/complexity-analyzer.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ESLint } from 'eslint';
import * as path from 'path';
import { 
  IComplexityIssue, 
  SecuritySeverity, 
  SecurityCheckType,
  COMPLEXITY_THRESHOLDS,
} from '../interfaces';

@Injectable()
export class ComplexityAnalyzerService {
  private readonly logger = new Logger(ComplexityAnalyzerService.name);
  private readonly maxComplexity: number;
  private readonly maxFunctionLength: number;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.maxComplexity = this.configService.get<number>('security.maxComplexity', 20);
    this.maxFunctionLength = this.configService.get<number>('security.maxFunctionLength', 100);
    this.timeoutMs = this.configService.get<number>('security.complexityScanTimeoutMs', 60000);
  }

  async analyze(workspacePath: string, correlationId: string): Promise<IComplexityIssue[]> {
    const issues: IComplexityIssue[] = [];

    try {
      const eslint = new ESLint({
        cwd: workspacePath,
        useEslintrc: false,
        overrideConfig: {
          plugins: ['@typescript-eslint'],
          parser: '@typescript-eslint/parser',
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
          rules: {
            'complexity': ['error', { max: this.maxComplexity }],
            'max-lines-per-function': ['error', { max: this.maxFunctionLength }],
            'max-depth': ['error', { max: 5 }],
          },
        },
      });

      const results = await eslint.lintFiles(['**/*.ts', '**/*.js']);

      for (const result of results) {
        for (const message of result.messages) {
          if (!this.isComplexityRule(message.ruleId)) continue;

          const metric = this.getMetricFromRule(message.ruleId!);
          const value = this.extractValueFromMessage(message.message);
          
          issues.push({
            checkType: SecurityCheckType.COMPLEXITY,
            severity: this.getSeverityForValue(metric, value),
            filePath: path.relative(workspacePath, result.filePath),
            functionName: this.extractFunctionName(message.message),
            lineNumber: message.line,
            metric,
            value,
            threshold: COMPLEXITY_THRESHOLDS[metric].medium,
            recommendation: this.getRecommendation(metric, value),
          });
        }
      }

      this.logger.debug(`[${correlationId}] Found ${issues.length} complexity issues`);
    } catch (error) {
      this.logger.error(`[${correlationId}] Complexity analysis failed: ${(error as Error).message}`);
    }

    return issues;
  }

  private isComplexityRule(ruleId: string | null): boolean {
    return ['complexity', 'max-lines-per-function', 'max-depth'].includes(ruleId || '');
  }

  private getMetricFromRule(ruleId: string): IComplexityIssue['metric'] {
    switch (ruleId) {
      case 'complexity': return 'cyclomatic';
      case 'max-lines-per-function': return 'function_length';
      case 'max-depth': return 'nesting_depth';
      default: return 'cyclomatic';
    }
  }

  private getSeverityForValue(metric: IComplexityIssue['metric'], value: number): SecuritySeverity {
    const thresholds = COMPLEXITY_THRESHOLDS[metric];
    if (value >= thresholds.critical) return SecuritySeverity.CRITICAL;
    if (value >= thresholds.high) return SecuritySeverity.HIGH;
    if (value >= thresholds.medium) return SecuritySeverity.MEDIUM;
    return SecuritySeverity.LOW;
  }

  private extractValueFromMessage(message: string): number {
    const match = message.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractFunctionName(message: string): string {
    const match = message.match(/(?:function|method)\s+['"]?(\w+)['"]?/i);
    return match ? match[1] : 'anonymous';
  }

  private getRecommendation(metric: IComplexityIssue['metric'], value: number): string {
    switch (metric) {
      case 'cyclomatic':
        return `Cyclomatic complexity is ${value}. Extract helper functions or use early returns.`;
      case 'function_length':
        return `Function has ${value} lines. Split into smaller, focused functions.`;
      case 'nesting_depth':
        return `Nesting depth is ${value}. Use guard clauses or extract nested logic.`;
      default:
        return 'Reduce code complexity';
    }
  }
}
```

---

### Step 6: Security Pattern Service

**File:** `src/qa-automation/scanners/security-pattern.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  ISecurityPatternFinding, 
  SecurityCheckType, 
  OWASP_PATTERNS,
  EXCLUDED_PATHS,
} from '../interfaces';

@Injectable()
export class SecurityPatternService {
  private readonly logger = new Logger(SecurityPatternService.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.timeoutMs = this.configService.get<number>('security.patternScanTimeoutMs', 30000);
  }

  async scan(workspacePath: string, correlationId: string): Promise<ISecurityPatternFinding[]> {
    const findings: ISecurityPatternFinding[] = [];
    const files = await this.getSourceFiles(workspacePath);

    this.logger.debug(`[${correlationId}] Scanning ${files.length} files for security patterns`);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          
          for (const pattern of OWASP_PATTERNS) {
            // Reset regex lastIndex for each line
            pattern.pattern.lastIndex = 0;
            const match = pattern.pattern.exec(line);
            
            if (match) {
              findings.push({
                checkType: SecurityCheckType.PATTERN,
                severity: pattern.severity,
                filePath: path.relative(workspacePath, filePath),
                lineNumber: lineNum + 1,
                patternType: pattern.type,
                matchedCode: this.truncateCode(match[0]),
                owaspCategory: pattern.category,
                recommendation: pattern.recommendation,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(`[${correlationId}] Could not scan ${filePath}`);
      }
    }

    this.logger.debug(`[${correlationId}] Found ${findings.length} security pattern violations`);
    return findings;
  }

  private async getSourceFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const sourceExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go'];
    
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!EXCLUDED_PATHS.includes(entry.name as any)) {
            await walk(fullPath);
          }
          continue;
        }

        if (sourceExtensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    await walk(dirPath);
    return files;
  }

  private truncateCode(code: string): string {
    return code.length > 100 ? `${code.slice(0, 100)}...` : code;
  }
}
```

---

### Step 7: Code Review Service (Main Orchestrator)

**File:** `src/qa-automation/code-review.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { DependencyScannerService } from './scanners/dependency-scanner.service';
import { SecretsScannerService } from './scanners/secrets-scanner.service';
import { ComplexityAnalyzerService } from './scanners/complexity-analyzer.service';
import { SecurityPatternService } from './scanners/security-pattern.service';
import {
  ISecurityScanResult,
  ISecurityScanOptions,
  ISecurityFinding,
  SecuritySeverity,
} from './interfaces';

@Injectable()
export class CodeReviewService {
  private readonly logger = new Logger(CodeReviewService.name);
  private readonly blockOnCritical: boolean;
  private readonly blockOnHigh: boolean;
  private readonly globalTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sentry: SentryService,
    private readonly dependencyScanner: DependencyScannerService,
    private readonly secretsScanner: SecretsScannerService,
    private readonly complexityAnalyzer: ComplexityAnalyzerService,
    private readonly securityPatternService: SecurityPatternService,
    @InjectMetric(QA_METRICS.SECURITY_SCANS_TOTAL) private readonly scansCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_SCAN_DURATION) private readonly scanDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.SECURITY_VULNERABILITIES) private readonly vulnCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_SECRETS_DETECTED) private readonly secretsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_COMPLEXITY_ISSUES) private readonly complexityCounter: Counter<string>,
    @InjectMetric(QA_METRICS.SECURITY_PATTERN_FINDINGS) private readonly patternCounter: Counter<string>,
  ) {
    this.blockOnCritical = this.configService.get<boolean>('security.blockOnCritical', true);
    this.blockOnHigh = this.configService.get<boolean>('security.blockOnHigh', true);
    this.globalTimeoutMs = this.configService.get<number>('security.scanTimeoutMs', 180000);
  }

  async scan(options: ISecurityScanOptions): Promise<ISecurityScanResult> {
    const { workspacePath, executionId, correlationId } = options;
    const startTime = Date.now();
    const endTimer = this.scanDuration.startTimer();

    this.logger.log(`[${correlationId}] Starting code review scan for execution ${executionId}`);

    const scannerResults: ISecurityScanResult['scannerResults'] = {
      dependency: { ran: false, passed: true, durationMs: 0, error: undefined },
      secrets: { ran: false, passed: true, durationMs: 0, error: undefined },
      complexity: { ran: false, passed: true, durationMs: 0, error: undefined },
      patterns: { ran: false, passed: true, durationMs: 0, error: undefined },
    };

    try {
      // Run all scanners in parallel with individual timing
      const [depResult, secretsResult, complexityResult, patternResult] = await Promise.allSettled([
        this.runWithTiming('dependency', () => 
          options.skipDependencyScan ? null : this.dependencyScanner.scan(workspacePath, correlationId), scannerResults),
        this.runWithTiming('secrets', () => 
          options.skipSecretsScan ? null : this.secretsScanner.scan(workspacePath, correlationId), scannerResults),
        this.runWithTiming('complexity', () => 
          options.skipComplexityScan ? null : this.complexityAnalyzer.analyze(workspacePath, correlationId), scannerResults),
        this.runWithTiming('patterns', () => 
          options.skipPatternScan ? null : this.securityPatternService.scan(workspacePath, correlationId), scannerResults),
      ]);

      // Extract results
      const vulnerabilities = this.extractSettledResult(depResult) || [];
      const secrets = this.extractSettledResult(secretsResult) || [];
      const complexityIssues = this.extractSettledResult(complexityResult) || [];
      const patternFindings = this.extractSettledResult(patternResult) || [];

      // Calculate summary
      const allFindings: ISecurityFinding[] = [...vulnerabilities, ...secrets, ...complexityIssues, ...patternFindings];
      const summary = this.calculateSummary(allFindings);
      const passed = this.determinePassFail(summary);

      // Track metrics
      this.trackMetrics(passed, vulnerabilities, secrets, complexityIssues, patternFindings);

      const result: ISecurityScanResult = {
        passed,
        executionId,
        correlationId,
        scanDurationMs: Date.now() - startTime,
        summary,
        vulnerabilities,
        secrets,
        complexityIssues,
        patternFindings,
        scannerResults,
        scannedAt: new Date(),
      };

      this.logger.log(
        `[${correlationId}] Code review complete: ${summary.totalFindings} findings ` +
        `(${summary.criticalCount} critical, ${summary.highCount} high), passed: ${passed}`
      );

      return result;
    } catch (error) {
      this.scansCounter.inc({ result: 'error' });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, correlationId, workspacePath },
      });
      throw error;
    } finally {
      endTimer();
    }
  }

  private async runWithTiming<T>(
    scannerKey: keyof ISecurityScanResult['scannerResults'],
    fn: () => Promise<T | null>,
    scannerResults: ISecurityScanResult['scannerResults'],
  ): Promise<T | null> {
    const start = Date.now();
    scannerResults[scannerKey].ran = true;
    try {
      const result = await fn();
      scannerResults[scannerKey].durationMs = Date.now() - start;
      return result;
    } catch (error) {
      scannerResults[scannerKey].durationMs = Date.now() - start;
      scannerResults[scannerKey].passed = false;
      scannerResults[scannerKey].error = (error as Error).message;
      throw error;
    }
  }

  private extractSettledResult<T>(result: PromiseSettledResult<T | null>): T | null {
    return result.status === 'fulfilled' ? result.value : null;
  }

  private calculateSummary(findings: ISecurityFinding[]) {
    return {
      totalFindings: findings.length,
      criticalCount: findings.filter(f => f.severity === SecuritySeverity.CRITICAL).length,
      highCount: findings.filter(f => f.severity === SecuritySeverity.HIGH).length,
      mediumCount: findings.filter(f => f.severity === SecuritySeverity.MEDIUM).length,
      lowCount: findings.filter(f => f.severity === SecuritySeverity.LOW).length,
      infoCount: findings.filter(f => f.severity === SecuritySeverity.INFO).length,
    };
  }

  private determinePassFail(summary: ISecurityScanResult['summary']): boolean {
    if (this.blockOnCritical && summary.criticalCount > 0) return false;
    if (this.blockOnHigh && summary.highCount > 0) return false;
    return true;
  }

  private trackMetrics(
    passed: boolean,
    vulnerabilities: any[],
    secrets: any[],
    complexityIssues: any[],
    patternFindings: any[],
  ): void {
    this.scansCounter.inc({ result: passed ? 'passed' : 'failed' });
    vulnerabilities.forEach(v => this.vulnCounter.inc({ severity: v.severity }));
    this.secretsCounter.inc({}, secrets.length);
    this.complexityCounter.inc({}, complexityIssues.length);
    patternFindings.forEach(p => this.patternCounter.inc({ type: p.patternType }));
  }

  async saveResult(executionId: string, result: ISecurityScanResult): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    const codeReviewIssues = {
      vulnerabilities: result.vulnerabilities,
      secrets: result.secrets, // Already masked
      complexityIssues: result.complexityIssues,
      patternFindings: result.patternFindings,
      summary: result.summary,
      scannerResults: result.scannerResults,
    };

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: { code_review_passed: result.passed, code_review_issues: codeReviewIssues },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: true,
          tests_passed: true,
          code_review_passed: result.passed,
          code_review_issues: codeReviewIssues,
          overall_passed: false,
        },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'code_review_scanned',
        actor_type: 'system',
        changes: { passed: result.passed, summary: result.summary, correlationId: result.correlationId },
      },
    });

    if (!result.passed) {
      const execution = await this.prisma.execution.findUnique({ where: { id: executionId } });
      if (execution) {
        await this.prisma.ticket.update({
          where: { id: execution.ticket_id },
          data: { status: 'QA_FAILED' },
        });
      }
    }
  }
}
```

---

### Step 8: Configuration

**File:** `src/config/configuration.ts` (ADD)

```typescript
security: {
  blockOnCritical: process.env.SECURITY_BLOCK_ON_CRITICAL !== 'false',
  blockOnHigh: process.env.SECURITY_BLOCK_ON_HIGH !== 'false',
  maxComplexity: parseInt(process.env.SECURITY_MAX_COMPLEXITY || '20', 10),
  maxFunctionLength: parseInt(process.env.SECURITY_MAX_FUNCTION_LENGTH || '100', 10),
  scanTimeoutMs: parseInt(process.env.SECURITY_SCAN_TIMEOUT_MS || '180000', 10),
  dependencyScanTimeoutMs: parseInt(process.env.SECURITY_DEP_SCAN_TIMEOUT_MS || '60000', 10),
  secretsScanTimeoutMs: parseInt(process.env.SECURITY_SECRETS_SCAN_TIMEOUT_MS || '30000', 10),
  complexityScanTimeoutMs: parseInt(process.env.SECURITY_COMPLEXITY_SCAN_TIMEOUT_MS || '60000', 10),
  patternScanTimeoutMs: parseInt(process.env.SECURITY_PATTERN_SCAN_TIMEOUT_MS || '30000', 10),
},
```

---

### Step 9: Metrics Constants

**File:** `src/common/metrics/metrics.constants.ts` (ADD to QA_METRICS)

```typescript
// Story 3.4 metrics:
SECURITY_SCANS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_security_scans_total`,
SECURITY_SCAN_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_security_scan_duration_seconds`,
SECURITY_VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
SECURITY_SECRETS_DETECTED: `${METRICS_CONSTANTS.PREFIX}qa_security_secrets_detected_total`,
SECURITY_COMPLEXITY_ISSUES: `${METRICS_CONSTANTS.PREFIX}qa_security_complexity_issues_total`,
SECURITY_PATTERN_FINDINGS: `${METRICS_CONSTANTS.PREFIX}qa_security_pattern_findings_total`,
```

---

## Testing Requirements

### Unit Tests

```typescript
describe('CodeReviewService', () => {
  it('should run all scanners in parallel');
  it('should track per-scanner duration');
  it('should fail on critical vulnerabilities (blockOnCritical=true)');
  it('should pass when only medium/low findings');
  it('should handle scanner errors gracefully');
});

describe('DependencyScannerService', () => {
  it('should parse NPM_AUDIT_SAMPLE_OUTPUT correctly');
  it('should auto-detect language');
  it('should handle missing package manager');
});

describe('SecretsScannerService', () => {
  it('should detect AWS keys with context');
  it('should skip excluded paths and files');
  it('should mask detected values');
});

describe('ComplexityAnalyzerService', () => {
  it('should map complexity to correct severity');
  it('should extract function names');
});

describe('SecurityPatternService', () => {
  it('should detect SQL injection');
  it('should return OWASP category');
});
```

---

## Prerequisites

| Story | Status | Required For |
|-------|--------|--------------|
| Story 1.3 (Database) | ✅ done | `qa_results`, `audit_logs` |
| Story 1.8 (Prometheus) | ✅ done | Metrics infrastructure |
| Story 1.9 (Sentry) | ✅ done | Error tracking |
| Story 3.1-3.3 | ready-for-dev | QA pipeline sequence |

---

## References

| Source | Section |
|--------|---------|
| `docs/architecture.md` | `code-review.service.ts` (line 156), NFR-S9, NFR-S10 |
| `docs/epics.md` | Story 3.4 acceptance criteria |
| `docs/prd.md` | FR68, NFR-S9, NFR-S10 |
| `prisma/schema.prisma` | QAResult model |

---

## Dev Agent Record

### Context Reference

- Uses `code-review.service.ts` per architecture.md line 156
- Story 3.3 provides coverage; this story provides security scanning
- Uses existing `QAResult.code_review_passed` and `code_review_issues` fields

### Agent Model Used

{{agent_model_name_version}}

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-02 | Story drafted | Scrum Master Bob |
| 2025-12-02 | Quality review: Fixed 5 critical, 4 enhancements, 3 optimizations | Quality Validator |

### Improvements Applied

- ✅ Added all 4 scanner service implementations (DependencyScanner, SecretsScanner, ComplexityAnalyzer, SecurityPattern)
- ✅ Renamed to `code-review.service.ts` per architecture.md
- ✅ Fixed AWS secret key pattern with context validation
- ✅ Added EXCLUDED_PATHS, EXCLUDED_EXTENSIONS, EXCLUDED_FILES constants
- ✅ Fixed TL;DR file count (17 files)
- ✅ Added NPM_AUDIT_SAMPLE_OUTPUT for testing
- ✅ Added Go language dependency scanning
- ✅ Added ESLint complexity plugin details with severity mapping
- ✅ Added LANGUAGE_DETECTION_FILES for auto-detection
- ✅ Added per-scanner timeout configuration
- ✅ Added COMPLEXITY_THRESHOLDS with severity mapping
- ✅ Added per-scanner timing in scannerResults
- ✅ Reduced DTO verbosity with reference to Story 3.3 pattern

### File List

<!-- Populated during implementation -->

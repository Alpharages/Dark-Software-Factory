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
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'aws_secret_key',
    pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'github_token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'github_oauth',
    pattern: /gho_[A-Za-z0-9]{36}/g,
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'generic_api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']([A-Za-z0-9_-]{20,})["']/gi,
    severity: SecuritySeverity.HIGH,
    contextValidator: (match, line) => !line.includes('.env') && !line.includes('process.env'),
  },
  {
    type: 'generic_secret',
    pattern: /(?:secret|token)\s*[=:]\s*["']([A-Za-z0-9_-]{16,})["']/gi,
    severity: SecuritySeverity.HIGH,
    contextValidator: (match, line) => !line.includes('example') && !line.includes('placeholder'),
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'jwt_token',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: SecuritySeverity.HIGH,
  },
  {
    type: 'database_url',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    severity: SecuritySeverity.CRITICAL,
  },
  {
    type: 'slack_webhook',
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/g,
    severity: SecuritySeverity.HIGH,
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
    pattern:
      /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;]*\+\s*(?:req\.|params\.|query\.|body\.|request\.)/gi,
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
    pattern:
      /(?:exec|spawn|execSync|spawnSync|execFile)\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/g,
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
    pattern:
      /(?:readFile|writeFile|createReadStream|createWriteStream|unlink|rmdir)\s*\([^)]*(?:\+|`\$\{)/g,
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

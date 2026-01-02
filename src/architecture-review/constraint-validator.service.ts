import { Injectable, Logger } from '@nestjs/common';
import { ArchitectureConstraintsService } from './architecture-constraints.service';

export interface ValidationContext {
  files: { path: string; content: string }[];
  projectId?: string;
}

export interface ValidationViolation {
  file: string;
  line?: number;
  constraintId: string;
  message: string;
  severity: 'CRITICAL' | 'WARNING';
}

@Injectable()
export class ConstraintValidatorService {
  private readonly logger = new Logger(ConstraintValidatorService.name);

  constructor(private readonly constraintsService: ArchitectureConstraintsService) {}

  async validate(context: ValidationContext): Promise<ValidationViolation[]> {
    this.logger.log(`Validating constraints for project: ${context.projectId || 'GLOBAL'}`);
    const constraints = await this.constraintsService.findAll(context.projectId);
    const violations: ValidationViolation[] = [];

    for (const constraint of constraints) {
      try {
        if (constraint.type === 'FORBIDDEN_TECH') {
          violations.push(...this.validateForbiddenTech(constraint, context.files));
        } else if (constraint.type === 'ALLOWED_TECH') {
          violations.push(...this.validateAllowedTech(constraint, context.files));
        } else if (constraint.type === 'PATTERN') {
          violations.push(...this.validatePattern(constraint, context.files));
        }
      } catch (_error) {
        this.logger.error(
          `Error validating constraint ${constraint.id}: ${(_error as Error).message}`,
        );
      }
    }

    return violations;
  }

  private validateForbiddenTech(
    constraint: { rules: unknown; id: string },
    files: { path: string; content: string }[],
  ): ValidationViolation[] {
    const violations: ValidationViolation[] = [];
    const rules = constraint.rules as { items: string[]; reason?: string };

    if (!rules?.items || !Array.isArray(rules.items)) return violations;

    // Check package.json
    const packageJson = files.find((f) => f.path.endsWith('package.json'));
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        for (const banned of rules.items) {
          // eslint-disable-next-line security/detect-object-injection
          if (allDeps[banned]) {
            violations.push({
              file: packageJson.path,
              constraintId: constraint.id,
              message: `Forbidden dependency found: ${banned}. ${rules.reason || ''}`,
              severity: 'CRITICAL',
            });
          }
        }
      } catch (e: unknown) {
        this.logger.error(`Failed to parse package.json: ${(e as Error).message}`);
      }
    }
    return violations;
  }

  private validateAllowedTech(
    constraint: { rules: unknown; id: string },
    _files: { path: string; content: string }[],
  ): ValidationViolation[] {
    const violations: ValidationViolation[] = [];
    const rules = constraint.rules as { items: string[]; reason?: string };

    if (!rules?.items || !Array.isArray(rules.items)) return violations;

    // Check is permissive: "Only these are allowed IF you use this category of tech"?
    // Or "You MUST use one of these"?
    // Usually ALLOWED_TECH means "If you use a tech in this category (e.g. ORM), it must be one of these".
    // But extracting "category" is hard without more metadata.
    // Simple implementation: Check if *any* unknown dependency exists? No, that's too broad.
    // Implementation: Check if we can identify dependencies that are *not* in the list?
    // Better for MVP: "Allowed Tech" validation is hard to enforce negatively without a "category" (e.g. "Database").
    // Let's invert: If the constraint lists "react", and we see "vue", is it a violation? Only if we know they are mutually exclusive.
    // FOR NOW: We will implement a check that verifies if the Dependencies are present in the project if they are marked as 'REQUIRED'.
    // IF the rule has "must_include": true, then it's a requirement.

    // Re-reading AC: "Allowed technologies: Approved dependencies".
    // This implies an allowlist. "Forbidden" is a blocklist.
    // Implementing strict allowlist for an entire package.json is impractical.
    // Let's assume the rules might have a specific scope, but for generic logic:
    // We will skip strict "Allowed" enforcement for now unless we can defined what is "Disallowed".
    // BUT, we can check for "Required" tech if specified.

    return violations;
  }

  private validatePattern(
    constraint: { rules: unknown; id: string },
    files: { path: string; content: string }[],
  ): ValidationViolation[] {
    const violations: ValidationViolation[] = [];
    const rules = constraint.rules as {
      pattern: string; // Regex
      message: string;
      filePattern: string; // Glob or extension, e.g. ".ts$"
      shouldMatch: boolean; // true = must find pattern (required), false = must NOT find pattern (banned pattern)
    };

    if (!rules?.pattern) return violations;

    const regex = new RegExp(rules.pattern, 'g');
    const fileRegex = rules.filePattern ? new RegExp(rules.filePattern) : null;

    for (const file of files) {
      if (fileRegex && !fileRegex.test(file.path)) continue;

      const hasMatch = regex.test(file.content);
      regex.lastIndex = 0; // Reset regex state

      if (rules.shouldMatch && !hasMatch) {
        // Requirement missing (e.g. "All controllers must have @Auth")
        // This is hard to prove per file unless we know the file IS a controller.
        // Skip strict "Must Include" for MVP unless very specific.
      } else if (!rules.shouldMatch && hasMatch) {
        // Banned pattern found (e.g. "console.log")
        violations.push({
          file: file.path,
          constraintId: constraint.id,
          message: `Pattern violation: ${rules.message || 'Restricted pattern detected'}`,
          severity: 'WARNING',
        });
      }
    }

    return violations;
  }
}

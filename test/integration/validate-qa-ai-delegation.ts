/**
 * Integration Validation Script for Story 3-10
 * Tests AiQaOrchestrator with Dark Software Factory project
 *
 * Run: npx ts-node test/integration/validate-qa-ai-delegation.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Test } from '@nestjs/testing';
import { AiQaOrchestrator } from '../../src/qa-automation/ai-qa-orchestrator.service';
import { OrchestratorService } from '../../src/ai-routing/orchestrator.service';
import { QaMetricsService } from '../../src/qa-automation/qa-metrics.service';
import { SentryService } from '../../src/common/sentry/sentry.service';
import { PrismaService } from '../../src/database/prisma.service';

async function validateQaAiDelegation() {
  console.log('🚀 Starting QA AI Delegation Validation...\n');

  // Setup test module
  const moduleRef = await Test.createTestingModule({
    providers: [
      AiQaOrchestrator,
      OrchestratorService,
      QaMetricsService,
      SentryService,
      PrismaService,
    ],
  }).compile();

  const aiQaOrchestrator = moduleRef.get<AiQaOrchestrator>(AiQaOrchestrator);

  const projectDir = process.cwd(); // Dark Software Factory root
  const ticketId = 'VALIDATION-3-10';

  interface QACheckResult {
    status: string;
    aiProvider?: string;
    data?: unknown; // Matches IQaResult from AiQaOrchestrator
  }

  const results = {
    lint: null as QACheckResult | null,
    test: null as QACheckResult | null,
    coverage: null as QACheckResult | null,
    security: null as QACheckResult | null,
    timings: {} as Record<string, number>,
  };

  // Test 1: Lint Check
  console.log('📋 Test 1: Lint Check (ESLint)');
  console.log('Expected: Detect ESLint, execute npm run lint, return structured JSON\n');

  try {
    const startLint = Date.now();
    results.lint = await aiQaOrchestrator.executeLintCheck(ticketId, projectDir);
    results.timings.lint = Date.now() - startLint;

    console.log('✅ Lint Check Result:');
    console.log(`   Status: ${results.lint.status}`);
    console.log(`   Duration: ${results.timings.lint}ms`);
    console.log(`   AI Provider: ${results.lint.aiProvider}`);
    console.log(`   Errors: ${(results.lint.data as any)?.errorCount || 0}`);
    console.log(`   Warnings: ${(results.lint.data as any)?.warningCount || 0}`);
    console.log(
      `   Performance: ${results.timings.lint < 60000 ? '✅ PASS' : '❌ FAIL'} (target: <60s)\n`,
    );
  } catch (error) {
    console.error('❌ Lint check failed:', (error as Error).message, '\n');
  }

  // Test 2: Test Run
  console.log('🧪 Test 2: Test Run (Jest)');
  console.log('Expected: Detect Jest, execute npm test, return test results\n');

  try {
    const startTest = Date.now();
    results.test = await aiQaOrchestrator.executeTestRun(ticketId, projectDir);
    results.timings.test = Date.now() - startTest;

    console.log('✅ Test Run Result:');
    console.log(`   Status: ${results.test.status}`);
    console.log(`   Duration: ${results.timings.test}ms`);
    console.log(`   AI Provider: ${results.test.aiProvider}`);
    console.log(`   Total Tests: ${(results.test.data as any)?.totalTests || 'N/A'}`);
    console.log(`   Passed: ${(results.test.data as any)?.passedCount || 'N/A'}`);
    console.log(`   Failed: ${(results.test.data as any)?.failedCount || 'N/A'}`);
    console.log(
      `   Performance: ${results.timings.test < 300000 ? '✅ PASS' : '❌ FAIL'} (target: <5min)\n`,
    );
  } catch (error) {
    console.error('❌ Test run failed:', (error as Error).message, '\n');
  }

  // Test 3: Coverage Analysis
  console.log('📊 Test 3: Coverage Analysis (Jest --coverage)');
  console.log('Expected: Execute npm test -- --coverage, return coverage percentages\n');

  try {
    const startCoverage = Date.now();
    results.coverage = await aiQaOrchestrator.executeCoverageAnalysis(ticketId, projectDir);
    results.timings.coverage = Date.now() - startCoverage;

    console.log('✅ Coverage Analysis Result:');
    console.log(`   Status: ${results.coverage.status}`);
    console.log(`   Duration: ${results.timings.coverage}ms`);
    console.log(`   AI Provider: ${results.coverage.aiProvider}`);
    console.log(`   Overall Coverage: ${(results.coverage.data as any)?.overall || 'N/A'}%`);
    console.log(`   Lines: ${(results.coverage.data as any)?.lines || 'N/A'}%`);
    console.log(`   Branches: ${(results.coverage.data as any)?.branches || 'N/A'}%`);
    console.log(`   Functions: ${(results.coverage.data as any)?.functions || 'N/A'}%`);
    console.log(
      `   Performance: ${results.timings.coverage < 60000 ? '✅ PASS' : '❌ FAIL'} (target: <60s)\n`,
    );
  } catch (error) {
    console.error('❌ Coverage analysis failed:', (error as Error).message, '\n');
  }

  // Test 4: Security Scan
  console.log('🔒 Test 4: Security Scan (npm audit)');
  console.log('Expected: Execute npm audit, return vulnerability findings\n');

  try {
    const startSecurity = Date.now();
    results.security = await aiQaOrchestrator.executeSecurityScan(ticketId, projectDir);
    results.timings.security = Date.now() - startSecurity;

    console.log('✅ Security Scan Result:');
    console.log(`   Status: ${results.security.status}`);
    console.log(`   Duration: ${results.timings.security}ms`);
    console.log(`   AI Provider: ${results.security.aiProvider}`);
    console.log(`   Critical: ${(results.security.data as any)?.criticalCount || 0}`);
    console.log(`   High: ${(results.security.data as any)?.highCount || 0}`);
    console.log(`   Medium: ${(results.security.data as any)?.mediumCount || 0}`);
    console.log(`   Low: ${(results.security.data as any)?.lowCount || 0}`);
    console.log(
      `   Performance: ${results.timings.security < 180000 ? '✅ PASS' : '❌ FAIL'} (target: <3min)\n`,
    );
  } catch (error) {
    console.error('❌ Security scan failed:', (error as Error).message, '\n');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('📊 VALIDATION SUMMARY');
  console.log('='.repeat(60));

  const passCount = [results.lint, results.test, results.coverage, results.security].filter(
    (r): r is QACheckResult => r !== null && r?.status === 'PASSED',
  ).length;
  const totalTests = 4;

  console.log(`\nTest Results: ${passCount}/${totalTests} PASSED`);
  console.log('\nPerformance Benchmarks:');
  console.log(`  Lint:     ${results.timings.lint || 'N/A'}ms (<60s target)`);
  console.log(`  Test:     ${results.timings.test || 'N/A'}ms (<5min target)`);
  console.log(`  Coverage: ${results.timings.coverage || 'N/A'}ms (<60s target)`);
  console.log(`  Security: ${results.timings.security || 'N/A'}ms (<3min target)`);

  const allPerformancePassed =
    (results.timings.lint || 999999) < 60000 &&
    (results.timings.test || 999999) < 300000 &&
    (results.timings.coverage || 999999) < 60000 &&
    (results.timings.security || 999999) < 180000;

  console.log(
    `\n${allPerformancePassed ? '✅' : '❌'} Performance: ${allPerformancePassed ? 'ALL PASS' : 'SOME FAIL'}`,
  );
  console.log(
    `${passCount === totalTests ? '✅' : '❌'} Functional: ${passCount}/${totalTests} checks passed`,
  );

  console.log('\n' + '='.repeat(60));
  console.log(
    passCount === totalTests && allPerformancePassed
      ? '✅ VALIDATION COMPLETE - STORY 3-10 READY FOR PRODUCTION'
      : '⚠️ VALIDATION INCOMPLETE - REVIEW FAILURES ABOVE',
  );
  console.log('='.repeat(60) + '\n');

  await moduleRef.close();

  return { results, passCount, totalTests, allPerformancePassed };
}

// Execute if run directly
if (require.main === module) {
  validateQaAiDelegation()
    .then(({ passCount, totalTests, allPerformancePassed }) => {
      process.exit(passCount === totalTests && allPerformancePassed ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal validation error:', error);
      process.exit(1);
    });
}

export { validateQaAiDelegation };

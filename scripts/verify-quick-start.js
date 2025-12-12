#!/usr/bin/env node

/**
 * Test Script: Verify GITHUB_DEFAULT_REPOSITORY Configuration
 *
 * This script checks if the quick start workaround is properly configured.
 * Run this before testing the complete workflow.
 */

const fs = require('fs');
const path = require('path');

const chalk = require('chalk');

// Load .env file manually
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
        console.error('❌ ERROR: .env file not found at', envPath);
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;

        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length) {
            let value = valueParts.join('=').trim();
            // Remove quotes if present
            value = value.replace(/^["']|["']$/g, '');
            process.env[key.trim()] = value;
        }
    });

    console.log('✅ Environment variables loaded from .env\n');
}

// Load environment
try {
    loadEnv();
} catch (error) {
    console.error('❌ Failed to load .env:', error.message);
    process.exit(1);
}

console.log(chalk.bold('\n🔍 Quick Start Workaround Verification\n'));

// Check 1: Environment variable exists
console.log('📋 Check 1: GITHUB_DEFAULT_REPOSITORY environment variable');
const repoUrl = process.env.GITHUB_DEFAULT_REPOSITORY;

if (!repoUrl) {
    console.log(chalk.red('❌ FAILED: GITHUB_DEFAULT_REPOSITORY is not set'));
    console.log(chalk.yellow('\n   Fix: Add this to your .env file:'));
    console.log(chalk.cyan('   GITHUB_DEFAULT_REPOSITORY=https://github.com/your-org/your-repo\n'));
    process.exit(1);
}

console.log(chalk.green(`✅ PASSED: ${repoUrl}`));

// Check 2: Valid URL format
console.log('\n📋 Check 2: URL format validation');
try {
    const url = new URL(repoUrl);

    if (!['http:', 'https:', 'git:'].includes(url.protocol)) {
        throw new Error('Invalid protocol');
    }

    if (!url.hostname) {
        throw new Error('Missing hostname');
    }

    console.log(chalk.green(`✅ PASSED: Valid URL (${url.protocol}//${url.hostname})`));
} catch (error) {
    console.log(chalk.red(`❌ FAILED: Invalid URL format - ${error.message}`));
    console.log(chalk.yellow('\n   Expected format: https://github.com/org/repo'));
    console.log(chalk.yellow('   Your value:', repoUrl, '\n'));
    process.exit(1);
}

// Check 3: GitHub repository (recommended)
console.log('\n📋 Check 3: GitHub repository check (recommended)');
const url = new URL(repoUrl);

if (url.hostname === 'github.com') {
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length >= 2) {
        console.log(chalk.green(`✅ PASSED: GitHub repo ${pathParts[0]}/${pathParts[1]}`));
    } else {
        console.log(chalk.yellow(`⚠️  WARNING: URL seems incomplete (${url.pathname})`));
        console.log(chalk.yellow('   Expected: https://github.com/org/repo'));
    }
} else {
    console.log(chalk.yellow(`⚠️  INFO: Not a GitHub repository (${url.hostname})`));
    console.log(chalk.yellow('   This works but GitHub is recommended'));
}

// Check 4: Other required env vars
console.log('\n📋 Check 4: Related configuration');

const checks = [
    { name: 'GITHUB_TOKEN', required: true },
    { name: 'DATABASE_URL', required: true },
    { name: 'RABBITMQ_URL', required: true },
];

let allPassed = true;

checks.forEach(check => {
    const value = process.env[check.name];

    if (!value && check.required) {
        console.log(chalk.red(`❌ ${check.name} is missing`));
        allPassed = false;
    } else if (!value) {
        console.log(chalk.yellow(`⚠️  ${check.name} is not set (optional)`));
    } else {
        // Mask sensitive values
        const masked = value.substring(0, 10) + '...';
        console.log(chalk.green(`✅ ${check.name} is set (${masked})`));
    }
});

// Summary
console.log(chalk.bold('\n📊 Summary\n'));

if (allPassed) {
    console.log(chalk.green('✅ All checks passed! You can now:'));
    console.log(chalk.white('   1. Restart the application: pnpm start:dev'));
    console.log(chalk.white('   2. Create a test ticket via ClickUp or database'));
    console.log(chalk.white('   3. Verify AI execution clones the correct repository'));
    console.log(chalk.white(`   4. Check logs for: "Cloning repository: ${repoUrl}"\n`));
    process.exit(0);
} else {
    console.log(chalk.red('❌ Some checks failed. Fix the issues above and run again.\n'));
    process.exit(1);
}

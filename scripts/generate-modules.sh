#!/bin/bash

# Generate all modules for AI Dev Orchestrator
# Usage: bash scripts/generate-modules.sh

echo "🚀 Generating NestJS modules..."

# Core infrastructure
npx @nestjs/cli g module config --no-spec
npx @nestjs/cli g module database --no-spec
npx @nestjs/cli g module auth --no-spec

# Webhook & Intake
npx @nestjs/cli g module webhooks --no-spec
npx @nestjs/cli g module ticket-intake --no-spec

# Messaging & Execution
npx @nestjs/cli g module rabbitmq --no-spec
npx @nestjs/cli g module ai-routing --no-spec
npx @nestjs/cli g module execution --no-spec

# Quality & Deployment
npx @nestjs/cli g module qa-automation --no-spec
npx @nestjs/cli g module github --no-spec
npx @nestjs/cli g module deployment --no-spec

# Monitoring & Cost
npx @nestjs/cli g module production-monitoring --no-spec
npx @nestjs/cli g module cost-tracking --no-spec
npx @nestjs/cli g module metrics --no-spec

# Dashboards & Realtime
npx @nestjs/cli g module dashboards --no-spec
npx @nestjs/cli g module realtime --no-spec

# External integrations
npx @nestjs/cli g module integration --no-spec

echo "✅ All modules generated successfully!"
echo "📝 Next: Update src/app.module.ts with imports"

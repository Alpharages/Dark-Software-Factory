# Epic 16 definition for ClickUp Dynamic Sync & Project Management

**Target**: Enable users to dynamically discover, import, and manage ClickUp projects from the UI, removing the reliance on static environment variables (`CLICKUP_MONITORED_LISTS`) and providing granular control over task syncing.

**Status**: in-progress
**Priority**: High
**Dependencies**: Epic 2 (ClickUp Integration Foundation), Epic 4 (Projects Table)
**Owner**: Antigravity

## Context
Currently, monitoring ClickUp lists requires modifying the `CLICKUP_MONITORED_LISTS` environment variable and restarting the backend. This is not scalable for users who managing multiple projects or want to quickly add a new one. This Epic aims to move this configuration into the database and provide a UI for management.

## Goals
1.  **Dynamic Discovery**: Users can browse their ClickUp hierarchy (Spaces -> Lists) from the dashboard.
2.  **Import & Sync**: Users can "Import" a ClickUp List as a DSF Project and toggle task monitoring.
3.  **Backward Compatibility**: Existing env-var based configuration is migrated or merged functionality.
5.  **Extensibility**: Architecture supports adding future providers (Jira, Asana) via Strategy pattern.

## Stories
- **[16-1] Backend: Dynamic Project Monitoring & Import API (Multi-Provider Ready)**
    - Schema updates (`Project.provider`).
    - Generic Integration API (`GET /api/v1/integrations/:provider/hierarchy`).
    - Sync Strategy Pattern.
- **[16-2] UI: Project Sync & Configuration Dashboard**
    - Provider Selector (ClickUp/Jira/Asana).
    - Generic Import Flow.

## Success Metrics
- Users can add a new monitored project without restarting the server.
- 100% of currently monitored lists are migrated to DB-based configuration.
- Reduce time-to-onboard new project from minutes (ops work) to seconds (UI click).

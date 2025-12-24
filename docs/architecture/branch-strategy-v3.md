# v3 Branch Selection Strategy

The AI Branch Strategist handles automated base branch selection for tickets based on their dependency chains. This prevents complex merge conflicts and ensures that dependent work is built on top of its precursors.

## Selection Logic

### 1. No Dependencies (AC#1)

- **Strategy**: `main`
- **Logic**: If a ticket has no dependencies, it is branched from the repository's `main` branch.
- **Base Branch**: `main`

### 2. Single Dependency (AC#2)

- **Strategy**: `follow`
- **Logic**: If a ticket has a single active dependency, it attempts to "follow" that dependency's feature branch.
- **Process**:
  1. Find all executions for the dependency ticket.
  2. Locate the most recent successful `GitHubPush` for those executions.
  3. Use that push's branch name as the base.
  4. **Fallback**: If no active feature branch is found, it defaults to `main`.

### 3. Multiple Dependencies (AC#3)

- **Strategy**: `merge-main`
- **Logic**: If a ticket has multiple dependencies, the system defaults to `main` as the base branch.
- **Reasoning**: Managing multiple concurrent feature branches as a base is complex. Multi-dependency tickets are branched from `main`, and Story 12.5 handles the subsequent merging of the dependent branches into the new feature branch.

## Audit & Observability

### AI Decision Logging (AC#4)

Every branch selection decision is logged via `AIDecisionLoggerService` with:

- **Action**: `branch_selection`
- **Reasoning**: A clear explanation of why a specific branch and strategy were chosen.
- **Input Data**: Dependency IDs and count.
- **Output Data**: Selected branch and strategy.

### Metrics (AC#5)

The system tracks selection types via Prometheus metrics:

- `branch_selection_total{strategy="main"}`
- `branch_selection_total{strategy="follow"}`
- `branch_selection_total{strategy="merge-main"}`

## Implementation Notes

- The service is implemented in `BranchStrategistService`.
- It integrates with `PrismaService` for data lookup and `MetricsService` for observability.
- It is designed to be called during the `TicketIntakeConsumer` flow in v3.

# Dark Software Factory - Task Processing Flow

Complete end-to-end flow showing how tasks move through the system from ClickUp creation to deployment.

## Main Flow Diagram

```mermaid
flowchart TD
    Start([START: ClickUp Task Created]) --> Polling

    Polling[ClickUp Polling Orchestrator<br/>Polls every 60s] --> Queue1{{"ticket-intake-queue"}}
    Queue1 --> Intake

    Intake[Ticket Intake Consumer<br/>Validates task] --> ValidCheck{Valid?}
    ValidCheck -->|Yes| Queue2{{"ai-execution-queue"}}
    ValidCheck -->|No| FailIntake[Validation Failed:<br/>Reject Task]

    Queue2 --> AIExec[AI Execution Consumer<br/>Generates code via Cursor CLI]
    AIExec --> AICheck{Success?}
    AICheck -->|Yes| Queue3{{"qa-check-queue"}}
    AICheck -->|No| RetryCheck{Retries<br/>< 3?}
    RetryCheck -->|Yes| Queue2
    RetryCheck -->|No| FailAI[AI Execution Failed:<br/>Send to DLQ]

    Queue3 --> QA[QA Orchestrator Consumer<br/>Runs tests, lint, security]
    QA --> QACheck{Passed?}
    QACheck -->|Yes| Queue4{{"github-push-trigger-queue"}}
    QACheck -->|No| FailQA[QA Check Failed:<br/>Log & Continue]
    FailQA --> Queue4

    Queue4 --> Commit[GitHub Commit Orchestrator<br/>AI commits & pushes code]
    Commit --> CommitCheck{Success?}
    CommitCheck -->|Yes| Queue5{{"github-pr-created-queue"}}
    CommitCheck -->|No| FailCommit[Commit Failed:<br/>Update status & alert]

    Queue5 --> PR[GitHub PR Orchestrator<br/>AI creates Pull Request]
    PR --> PRCheck{Success?}
    PRCheck -->|Yes| Deploy
    PRCheck -->|No| FailPR[PR Creation Failed:<br/>Update status & alert]

    Deploy[Deployment Orchestrator<br/>Triggers GitHub Actions] --> DeployPoll[Poll deployment status<br/>Exponential backoff: 30s→60s→90s]
    DeployPoll --> DeployCheck{Status?}
    DeployCheck -->|Success| End
    DeployCheck -->|Running| DeployPoll
    DeployCheck -->|Failed| FailDeploy[Deployment Failed:<br/>Update status & alert]
    DeployCheck -->|Timeout| FailTimeout[Deployment Timeout:<br/>30min exceeded]

    End([END: Deployment Complete])

    style Start fill:#99e9a5,stroke:#1e7b34
    style End fill:#99e9a5,stroke:#1e7b34
    style Polling fill:#a5d8ff,stroke:#1971c2
    style Intake fill:#a5d8ff,stroke:#1971c2
    style AIExec fill:#ffc078,stroke:#e67700
    style QA fill:#e599f7,stroke:#9c36b5
    style Commit fill:#8ce99a,stroke:#2b8a3e
    style PR fill:#8ce99a,stroke:#2b8a3e
    style Deploy fill:#c0eb75,stroke:#5c940d
    style DeployPoll fill:#c0eb75,stroke:#5c940d
    style FailIntake fill:#ffc9c9,stroke:#c92a2a
    style FailAI fill:#ffc9c9,stroke:#c92a2a
    style FailQA fill:#ffe066,stroke:#fab005
    style FailCommit fill:#ffc9c9,stroke:#c92a2a
    style FailPR fill:#ffc9c9,stroke:#c92a2a
    style FailDeploy fill:#ffc9c9,stroke:#c92a2a
    style FailTimeout fill:#ffc9c9,stroke:#c92a2a
    style Queue1 fill:#f1f3f5,stroke:#868e96
    style Queue2 fill:#f1f3f5,stroke:#868e96
    style Queue3 fill:#f1f3f5,stroke:#868e96
    style Queue4 fill:#f1f3f5,stroke:#868e96
    style Queue5 fill:#f1f3f5,stroke:#868e96
```

## Key Components

### 1. **Entry Point: ClickUp Polling**

- Polls ClickUp API every 60 seconds for task updates
- Publishes discovered tasks to `ticket-intake-queue`
- Uses exponential backoff on rate limits

### 2. **Ticket Intake Validation**

- Validates task structure and required fields
- Rejects invalid tasks immediately
- Creates database record for valid tasks
- Publishes to `ai-execution-queue`

### 3. **AI Code Generation**

- Uses Cursor CLI (or other AI providers) to generate code
- Automatically detects project type and installs dependencies
- **Retry Logic**: Up to 3 attempts for transient failures
- Non-retryable errors (invalid prompt, auth failures) sent to DLQ
- Publishes to `qa-check-queue` on success

### 4. **QA Automation**

- Runs automated tests (Jest, pytest, etc.)
- Executes lint checks (ESLint, etc.)
- Performs security scans
- **Failure Handling**: Logs failures but continues workflow
- Publishes to `github-push-trigger-queue`

### 5. **GitHub Commit**

- AI analyzes changes and generates comprehensive commit message
- Follows conventional commits format
- Pushes to feature branch
- Updates database with commit SHA

### 6. **GitHub PR Creation**

- AI generates PR title and description
- Creates PR via GitHub CLI
- Links to original ClickUp ticket
- Publishes to `github-pr-created-queue`

### 7. **Deployment**

- Detects CI/CD provider (GitHub Actions)
- Triggers workflow via Workflow Dispatch API
- **Polling**: Checks status with exponential backoff
- **Timeout**: 30 minutes maximum
- Updates deployment status in database

## Error Handling Summary

| Stage            | Failure Action | Retry?      | Next Step         |
| ---------------- | -------------- | ----------- | ----------------- |
| **Validation**   | Reject task    | ❌ No       | End               |
| **AI Execution** | Send to DLQ    | ✅ Yes (3x) | Continue or fail  |
| **QA Checks**    | Log failure    | ❌ No       | Continue workflow |
| **Commit**       | Update status  | ❌ No       | Alert & end       |
| **PR Creation**  | Update status  | ❌ No       | Alert & end       |
| **Deployment**   | Update status  | ❌ No       | Alert & end       |

## RabbitMQ Queues

1. `ticket-intake-queue` - Raw ClickUp task events
2. `ai-execution-queue` - Validated tasks ready for AI processing
3. `qa-check-queue` - Code generated, ready for QA
4. `github-push-trigger-queue` - QA complete, ready for commit
5. `github-pr-created-queue` - Code committed, ready for PR & deployment

## Monitoring & Metrics

All stages emit Prometheus metrics:

- Success/failure counters
- Duration histograms
- Queue depth gauges
- Error categorization

Critical failures are captured in **Sentry** for alerting and debugging.

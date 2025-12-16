# Grafana Dashboards for Dark Software Factory

This directory contains Grafana dashboard JSON files that can be imported into any Grafana instance.

## Available Dashboards

### QA Automation Overview

**File:** `dashboards/qa-automation-overview.json`

Monitors QA automation workflows with the following panels:

- **QA Checks Total**: Total number of QA checks performed
- **QA Check Status Breakdown**: Pie chart showing passed/failed/error distribution
- **QA Checks by Type**: Bar gauge for linting, testing, security, coverage, and gate checks
- **QA Check Timeline**: Time series showing QA check rate over time

**Metrics Used:**

- `dsf_qa_checks_total`

## How to Import Dashboards

### Method 1: Grafana UI (Recommended)

1. Open Grafana at http://localhost:3001 (or your production Grafana URL)
2. Navigate to **Dashboards** → **Import**
3. Click **Upload JSON file**
4. Select the dashboard JSON file (e.g., `qa-automation-overview.json`)
5. Select your Prometheus data source
6. Click **Import**

### Method 2: Grafana API

```bash
# Import dashboard via API
curl -X POST http://admin:admin@localhost:3001/api/dashboards/import \
  -H "Content-Type: application/json" \
  -d @grafana/dashboards/qa-automation-overview.json
```

### Method 3: Grafana Provisioning (Production)

For automatic dashboard provisioning in production:

1. Create a provisioning directory structure:

```
/etc/grafana/provisioning/
├── dashboards/
│   ├── dashboard.yml
│   └── qa-automation-overview.json
└── datasources/
    └── prometheus.yml
```

2. Create `/etc/grafana/provisioning/dashboards/dashboard.yml`:

```yaml
apiVersion: 1

providers:
  - name: 'Dark Software Factory'
    orgId: 1
    folder: 'DSF Monitoring'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

3. Copy dashboard JSON files to `/etc/grafana/provisioning/dashboards/`

4. Restart Grafana

## Prerequisites

- Grafana instance (v9.0+ recommended)
- Prometheus data source configured with access to DSF metrics
- The following metrics must be available:
  - `dsf_qa_checks_total`
  - `dsf_ai_executions_total` (for future dashboards)
  - `dsf_webhook_received_total` (for future dashboards)

## Data Source Configuration

Ensure your Prometheus data source is configured with:

- **URL**: `http://prometheus:9090` (Docker) or `http://localhost:9090` (local)
- **Access**: Server (for Docker) or Browser (for localhost)
- **Scrape interval**: 10s
- **Query timeout**: 60s

## Dashboard Variables

The dashboards use the following templating variables (if applicable):

- `$datasource`: Prometheus data source selector
- `$interval`: Auto-calculated scrape interval

## Customization

You can customize the dashboards by:

1. Importing the JSON file
2. Editing panels in the Grafana UI
3. Exporting the updated JSON
4. Replacing the file in this directory

## Troubleshooting

**No data showing in panels:**

- Verify Prometheus is scraping metrics from your app
- Check the Prometheus data source connection in Grafana
- Verify metrics exist: `http://localhost:9090/graph` → query `dsf_qa_checks_total`

**Dashboard import fails:**

- Ensure you're using Grafana v9.0 or later
- Check that the JSON file is valid
- Verify the Prometheus data source exists before importing

**Panels show "N/A" or empty:**

- Run your application with `pnpm start:dev`
- Execute E2E tests to generate metrics: `node scripts/test-e2e-standalone.js --use-app`
- Wait 10-30 seconds for Prometheus to scrape the metrics

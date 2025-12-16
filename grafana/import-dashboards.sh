#!/bin/bash

# Grafana Dashboard Import Script for Dark Software Factory
# This script imports dashboards into Grafana via the API

set -e

# Configuration
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-admin}"
DASHBOARD_DIR="$(dirname "$0")/dashboards"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================"
echo "Grafana Dashboard Import Script"
echo "================================"
echo ""
echo "Grafana URL: $GRAFANA_URL"
echo "Dashboard Directory: $DASHBOARD_DIR"
echo ""

# Check if Grafana is accessible
echo -n "Checking Grafana connection... "
if curl -s -f -u "$GRAFANA_USER:$GRAFANA_PASSWORD" "$GRAFANA_URL/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${RED}✗ Failed${NC}"
    echo "Error: Cannot connect to Grafana at $GRAFANA_URL"
    echo "Please check:"
    echo "  1. Grafana is running"
    echo "  2. GRAFANA_URL is correct"
    echo "  3. Credentials are correct"
    exit 1
fi

# Function to import a dashboard
import_dashboard() {
    local dashboard_file="$1"
    local dashboard_name=$(basename "$dashboard_file" .json)
    
    echo -n "Importing $dashboard_name... "
    
    response=$(curl -s -X POST \
        -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
        -H "Content-Type: application/json" \
        -d @"$dashboard_file" \
        "$GRAFANA_URL/api/dashboards/import" 2>&1)
    
    if echo "$response" | grep -q '"importedUrl"'; then
        echo -e "${GREEN}✓ Success${NC}"
        # Extract and display the dashboard URL
        dashboard_url=$(echo "$response" | grep -o '"importedUrl":"[^"]*"' | cut -d'"' -f4)
        echo "   → $GRAFANA_URL$dashboard_url"
        return 0
    else
        echo -e "${RED}✗ Failed${NC}"
        echo "   Response: $response"
        return 1
    fi
}

# Import all dashboards
success_count=0
fail_count=0

if [ ! -d "$DASHBOARD_DIR" ]; then
    echo -e "${RED}Error: Dashboard directory not found: $DASHBOARD_DIR${NC}"
    exit 1
fi

dashboard_files=$(find "$DASHBOARD_DIR" -name "*.json" -type f)

if [ -z "$dashboard_files" ]; then
    echo -e "${YELLOW}Warning: No dashboard files found in $DASHBOARD_DIR${NC}"
    exit 0
fi

echo ""
echo "Found $(echo "$dashboard_files" | wc -l) dashboard(s) to import:"
echo ""

for dashboard_file in $dashboard_files; do
    if import_dashboard "$dashboard_file"; then
        ((success_count++))
    else
        ((fail_count++))
    fi
done

# Summary
echo ""
echo "================================"
echo "Import Summary"
echo "================================"
echo -e "${GREEN}Success: $success_count${NC}"
if [ $fail_count -gt 0 ]; then
    echo -e "${RED}Failed: $fail_count${NC}"
fi
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}All dashboards imported successfully!${NC}"
    exit 0
else
    echo -e "${YELLOW}Some dashboards failed to import${NC}"
    exit 1
fi

# OpenSandbox Server Ops Runbook

This runbook contains the operations instructions to deploy and manage the OpenSandbox server as a standalone service. The OpenSandbox server provides a secure execution environment for AI agents avoiding Docker-outside-of-Docker (DooD) on the main DSF server.

## 1. Server Requirements

- OS: Ubuntu 22.04 LTS or Debian 12 (recommended)
- CPU: 2+ vCPU (4+ recommended for concurrent sandboxes)
- RAM: 4 GB minimum (8 GB recommended)
- Disk: 20 GB minimum (Docker image storage)
- Docker Engine: installed and running (`docker --version`)
- Python + uv: for installing opensandbox-server
- **Firewall:** Port `8080` must be open inbound **only from the DSF server IP** — never from `0.0.0.0/0`. Example (ufw):
  ```bash
  sudo ufw allow from <DSF_SERVER_IP> to any port 8080
  sudo ufw deny 8080
  ```
  Or configure your cloud security group / VPC firewall rule equivalently.

## 2. Installation

```bash
# Install uv (Python package manager)
curl -Ls https://astral.sh/uv/install.sh | sh
source ~/.bashrc

# Install opensandbox-server
uv pip install opensandbox-server

# Verify
opensandbox-server --version
```

## 3. Configuration — `~/.sandbox.toml`

Create `~/.sandbox.toml` with the following configuration:

```toml
[server]
api_key = "<OPENSANDBOX_API_KEY>"   # Generate a strong random key, copy to DSF OPENSANDBOX_API_KEY
host = "0.0.0.0"
port = 8080

[runtime]
type = "docker"

[docker]
network_mode = "bridge"   # Each sandbox gets an isolated bridge network

[sandbox]
max_timeout_seconds = 3600  # 1 hour max per execution

[secure_container]
# Options: "" (standard Docker), "gvisor", "kata-qemu", "firecracker"
runtime = ""
```

> **Note:** Generate `api_key` with: `openssl rand -hex 32`

## 4. Starting the Server

Manual (dev/test):

```bash
opensandbox-server
```

As a systemd service (production):

```ini
# /etc/systemd/system/opensandbox.service
[Unit]
Description=OpenSandbox Server
After=docker.service
Requires=docker.service

[Service]
User=opensandbox
ExecStart=/home/opensandbox/.local/bin/opensandbox-server
Restart=always
RestartSec=5
Environment=HOME=/home/opensandbox

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable opensandbox
sudo systemctl start opensandbox
sudo systemctl status opensandbox
```

## 5. Health Check

From the OpenSandbox server itself:

```bash
curl -H "Authorization: Bearer <OPENSANDBOX_API_KEY>" http://localhost:8080/health
# Expected: {"status":"ok"}
```

From the DSF server (verify network reachability):

```bash
curl -H "Authorization: Bearer <OPENSANDBOX_API_KEY>" http://<OPENSANDBOX_DOMAIN>/health
# Expected: {"status":"ok"}
```

## 6. Pre-pull Required Docker Image

Must be done on the OpenSandbox server (not the DSF server):

```bash
docker pull opensandbox/code-interpreter:v1.0.2
docker run --rm opensandbox/code-interpreter:v1.0.2 node --version
# Expected: v22.x.x or similar
```

## 7. Restart Procedure

```bash
sudo systemctl restart opensandbox
# Wait for health check to succeed before re-enabling traffic
```

## 8. DSF Environment Variables

The following must be set in the DSF backend `.env` (handled in story OS-1.2):

```dotenv
OPENSANDBOX_DOMAIN=http://<your-opensandbox-server-ip>:8080
OPENSANDBOX_API_KEY=<same-api_key-from-sandbox.toml>
OPENSANDBOX_AGENT_IMAGE=opensandbox/code-interpreter:v1.0.2
OPENSANDBOX_MAX_CONCURRENT=5
```

## 9. Troubleshooting

- **Server fails to start:** Check logs using `journalctl -u opensandbox -f` or run the server manually to see startup errors.
- **Health check fails (Timeout):** Verify that the firewall allows inbound traffic on port `8080` strictly from the DSF server IP.
- **Health check fails (Unauthorized):** Ensure `OPENSANDBOX_API_KEY` exactly matches `api_key` in `~/.sandbox.toml`.
- **Sandbox execution fails:** Ensure Docker Engine is running and the required Docker image has been pre-pulled.

# Docker Environment Configuration Guide

## Overview

The Dark Software Factory uses a `.env` file to configure all environment variables for Docker Compose services. This approach provides:

✅ **Separation of configuration from code**  
✅ **Easy customization per environment**  
✅ **Security** - `.env` is gitignored, preventing secrets from being committed  
✅ **Consistency** - Single source of truth for environment variables

## Quick Start

### 1. Create Your `.env` File

```bash
# Copy the example file
cp .env.example .env
```

### 2. Configure Required Variables

Edit `.env` and set the following **required** variables:

```bash
# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Set your database password (default is "postgres" for development)
POSTGRES_PASSWORD=postgres

# Set your RabbitMQ password (default is "guest" for development)
RABBITMQ_PASS=guest
```

### 3. Start Docker Services

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Environment Variables Reference

### Docker Compose Services

| Variable             | Default           | Description                  |
| -------------------- | ----------------- | ---------------------------- |
| `POSTGRES_USER`      | `postgres`        | PostgreSQL database user     |
| `POSTGRES_PASSWORD`  | `postgres`        | PostgreSQL database password |
| `POSTGRES_DB`        | `ai_orchestrator` | PostgreSQL database name     |
| `POSTGRES_PORT`      | `5432`            | PostgreSQL exposed port      |
| `RABBITMQ_USER`      | `guest`           | RabbitMQ username            |
| `RABBITMQ_PASS`      | `guest`           | RabbitMQ password            |
| `RABBITMQ_VHOST`     | `/`               | RabbitMQ virtual host        |
| `RABBITMQ_PORT`      | `5672`            | RabbitMQ AMQP port           |
| `RABBITMQ_MGMT_PORT` | `15672`           | RabbitMQ Management UI port  |
| `APP_PORT`           | `3000`            | Application exposed port     |

### Monitoring Services (Optional)

These are only needed when running with `--profile monitoring`:

| Variable           | Default | Description             |
| ------------------ | ------- | ----------------------- |
| `PROMETHEUS_PORT`  | `9090`  | Prometheus exposed port |
| `GRAFANA_PORT`     | `3001`  | Grafana exposed port    |
| `GRAFANA_USER`     | `admin` | Grafana admin username  |
| `GRAFANA_PASSWORD` | `admin` | Grafana admin password  |

### Application Configuration

| Variable                 | Required | Description                                                  |
| ------------------------ | -------- | ------------------------------------------------------------ |
| `JWT_SECRET`             | ✅ Yes   | JWT signing secret (generate with `openssl rand -base64 32`) |
| `JWT_EXPIRATION`         | No       | JWT expiration time in seconds (default: `3600`)             |
| `GITHUB_APP_ID`          | No       | GitHub App ID for integration                                |
| `GITHUB_APP_PRIVATE_KEY` | No       | GitHub App private key                                       |
| `CLICKUP_WEBHOOK_SECRET` | No       | ClickUp webhook secret                                       |
| `CURSOR_API_KEY`         | No       | Cursor AI API key                                            |
| `WINDSURF_API_KEY`       | No       | Windsurf AI API key                                          |
| `ANTHROPIC_API_KEY`      | No       | Anthropic Claude API key                                     |
| `SENTRY_DSN`             | No       | Sentry error tracking DSN                                    |

### Sandbox Resource Limits (Story 23.3)

Controls resource limits for AI agent containers to prevent one runaway agent from crashing the host:

| Variable                         | Default | Description                                                         |
| -------------------------------- | ------- | ------------------------------------------------------------------- |
| `SANDBOX_ENABLE_RESOURCE_LIMITS` | `true`  | Master switch to enable/disable resource limits                     |
| `SANDBOX_MEMORY_LIMIT_MB`        | `512`   | Memory limit per container in MB (64-8192)                          |
| `SANDBOX_CPU_LIMIT_PERCENT`      | `100`   | CPU limit as % of single core (10-400), 100 = 1 core, 200 = 2 cores |
| `SANDBOX_MEMORY_SWAP_LIMIT_MB`   | `512`   | Swap limit in MB (0 to disable swap, recommended for strict limits) |

#### Resource Profiles

Containers can use predefined resource profiles based on task complexity:

| Profile  | Memory | CPU  | Use Case                             |
| -------- | ------ | ---- | ------------------------------------ |
| `small`  | 256MB  | 50%  | Simple tasks, linting, small fixes   |
| `medium` | 512MB  | 100% | Standard development tasks (default) |
| `large`  | 1024MB | 200% | Complex builds, large refactors      |

**Example: Running with Strict Memory Limits**

```bash
# Disable swap for strict memory enforcement
SANDBOX_ENABLE_RESOURCE_LIMITS=true
SANDBOX_MEMORY_LIMIT_MB=512
SANDBOX_MEMORY_SWAP_LIMIT_MB=0
SANDBOX_CPU_LIMIT_PERCENT=100
```

**Example: High-Performance Agents**

```bash
# Allow more resources for build-heavy tasks
SANDBOX_MEMORY_LIMIT_MB=2048
SANDBOX_CPU_LIMIT_PERCENT=200
```

## How Docker Compose Uses `.env`

Docker Compose automatically loads variables from `.env` in the same directory as `docker-compose.yml`. Variables are referenced using `${VARIABLE_NAME}` syntax:

```yaml
environment:
  POSTGRES_USER: ${POSTGRES_USER}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

### Default Values

You can provide default values using `${VAR:-default}` syntax:

```yaml
ports:
  - '${APP_PORT:-3000}:3000' # Uses 3000 if APP_PORT is not set
```

## Running with Monitoring

To start Prometheus and Grafana for monitoring:

```bash
docker-compose --profile monitoring up -d
```

Access:

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001
  - Username: `admin`
  - Password: `admin` (or your `GRAFANA_PASSWORD`)

## Troubleshooting

### Services won't start

1. Check if `.env` file exists:

   ```bash
   ls -la .env
   ```

2. Verify environment variables are loaded:

   ```bash
   docker-compose config
   ```

3. Check service logs:
   ```bash
   docker-compose logs postgres
   docker-compose logs rabbitmq
   docker-compose logs app
   ```

### Port conflicts

If ports are already in use, update the port variables in `.env`:

```bash
POSTGRES_PORT=5433  # Instead of 5432
APP_PORT=3001       # Instead of 3000
```

### Database connection issues

Ensure the `DATABASE_URL` in your app configuration matches the Docker service:

```bash
# For running app in Docker
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public

# For running app locally (outside Docker)
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=public
```

## Security Best Practices

1. **Never commit `.env`** - It's in `.gitignore` for a reason
2. **Generate strong secrets**:

   ```bash
   # JWT Secret
   openssl rand -base64 32

   # ClickUp Webhook Secret
   openssl rand -hex 16
   ```

3. **Use different passwords** in production
4. **Rotate secrets regularly** in production environments
5. **Use environment-specific `.env` files**:
   - `.env.development`
   - `.env.staging`
   - `.env.production`

## Production Deployment

For production, use a secrets management solution instead of `.env` files:

- **Docker Secrets** (Docker Swarm)
- **Kubernetes Secrets**
- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**

## Additional Resources

- [Docker Compose Environment Variables Documentation](https://docs.docker.com/compose/environment-variables/)
- [Best Practices for Environment Variables](https://12factor.net/config)

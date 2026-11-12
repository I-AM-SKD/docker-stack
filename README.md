# Production 3-Tier Node.js Microservice with Segmented Networks & Automated AWS S3 Backups

A production-grade, network-segmented 3-tier microservice architecture deployed on an Ubuntu AWS EC2 instance. The application is containerized with Docker, reverse-proxied with Nginx, stores data in PostgreSQL 17, and enforces automated, encrypted database disaster-recovery backups to AWS S3 using IAM role authentication.

---

## Architecture Overview

![System Architecture Diagram](docs/images/architecture-diagram.png)

### Architectural Flowchart & Network Topology

```mermaid
flowchart TD
    subgraph Internet["Public Internet"]
        Client["Client / Web Browser / curl"]
    end

    subgraph Host["AWS EC2 Host (Ubuntu 24.04 LTS • 15.206.90.254)"]
        subgraph SG["Security Group Ingress"]
            P80["Inbound TCP :80 (HTTP)"]
            P22["Inbound TCP :22 (SSH)"]
        end

        subgraph FN["Docker Network: frontend_net (bridge)"]
            Proxy["proxy (Nginx 1.27-alpine)<br/>• Host Port: 80:80 (ONLY published port)<br/>• Reverse-proxies /api/* & /health<br/>• Upstream Keepalive: 16"]
        end

        subgraph DualHomed["Bridged Tier"]
            API["api (Node.js 22-Alpine / Express)<br/>• 0.0.0.0:3000 (NO host port exposed!)<br/>• Non-root: USER node (UID 1000)<br/>• Dual-homed: frontend_net + backend_net<br/>• Limits: 0.50 CPU, 256MB RAM"]
        end

        subgraph BN["Docker Network: backend_net (internal: true)"]
            DB[("db (PostgreSQL 17-alpine)<br/>• Port 5432 (Internal ONLY)<br/>• NO internet outbound access<br/>• Volume: pgdata")]
        end

        subgraph Automation["Host Automation"]
            Cron["Linux Cron (Hourly)<br/>/scripts/backup-db.sh<br/>• pg_dump over stdout via docker exec -T<br/>• gzip on-the-fly<br/>• set -euo pipefail"]
        end
    end

    subgraph AWS["AWS Cloud Services"]
        IAM["IAM Instance Profile<br/>Role: EC2-S3-Backup-Role<br/>• Zero AWS access keys on server disk"]
        S3[("Amazon S3 Bucket<br/>sandeep-docker-stack-backups-2026<br/>• Prefix: /backups/tasksdb_*.sql.gz<br/>• Block Public Access: ON<br/>• Region: ap-south-1")]
    end

    %% Network flows
    Client -->|HTTP Request| P80
    P80 --> Proxy
    Proxy -->|proxy_pass http://api:3000| API
    Proxy -.->|Route Blocked / Bad Address| DB
    API -->|Port 5432 query / pool| DB
    DB -->|pgdata volume mount| DB

    %% Backup flows
    DB -.->|docker compose exec -T db pg_dump| Cron
    Host -->|Instance Metadata / Temporary STS Token| IAM
    IAM -.->|Grants S3 PutObject Permission| Cron
    Cron -->|aws s3 cp compressed archive| S3

    %% Styling
    classDef internet fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
    classDef proxy fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f0fdf4;
    classDef api fill:#1e3a8a,stroke:#60a5fa,stroke-width:2px,color:#eff6ff;
    classDef db fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#e0e7ff;
    classDef aws fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7;
    classDef cron fill:#262626,stroke:#a3a3a3,stroke-width:2px,color:#fafafa;

    class Client internet;
    class Proxy proxy;
    class API api;
    class DB db;
    class IAM,S3 aws;
    class Cron cron;
```

---

## Key Features & Production Engineering Practices

1. **2-Tier Network Segmentation**:
   - `frontend_net`: Connects `proxy` and `api`.
   - `backend_net` (`internal: true`): Connects `api` and `db`. Isolated completely from the internet and unreachable by `proxy`.
2. **Least Privilege Container Security**:
   - Only `proxy` binds to host port `80:80`.
   - Neither `api` (`3000`) nor `db` (`5432`) expose ports to the host or internet.
   - Node API runs as non-root user `USER node` (`UID 1000`).
3. **Resilient Database Lifecycles**:
   - `initDb()` with exponential retry loop (15 attempts) handles database startup delays.
   - Graceful healthchecks (`pg_isready` on Postgres and `wget` on Node API) coordinate dependent startup via `depends_on: condition: service_healthy`.
4. **Zero-Key Disaster Recovery (DR)**:
   - AWS IAM Instance Profile (`EC2-S3-Backup-Role`) automatically authenticates AWS CLI without saving `.aws/credentials` on the server.
   - Automated hourly backups via Linux `cron` dumping compressed SQL archives to AWS S3 (`sandeep-docker-stack-backups-2026`).

---

## Repository Structure

```
.
├── .env.example              # Safe template committed to Git
├── .gitignore                # Strict rules ignoring .env, node_modules, *.sql.gz
├── compose.yaml              # Multi-tier network segmented Docker Compose configuration
├── api/
│   ├── .dockerignore         # Excludes node_modules, .env, and local clutter
│   ├── Dockerfile            # Multi-layer cached build, Alpine base, non-root user
│   ├── package.json          # Express and PostgreSQL (pg) dependencies
│   └── server.js             # REST API endpoints (/health, /api/tasks), DB retry loop
├── nginx/
│   └── nginx.conf            # Layer 7 Reverse Proxy with HTTP/1.1 Keep-Alive
├── scripts/
│   └── backup-db.sh          # Fail-safe (set -euo pipefail) S3 backup automation
└── docs/
    ├── guide.md              # Full zero-to-hero step-by-step rebuild manual
    └── images/               # AWS deployment verification screenshots
        ├── aws-ec2-instance.jpg
        ├── aws-iam-role.png
        ├── aws-s3-backup-file.png
        └── aws-s3-bucket.png
```

---

## 10-Point Production Acceptance Checklist (Definition of Done)

| # | Verification Check | Command | Expected Result |
|---|---|---|---|
| 1 | Health Check via Proxy | `curl -i http://localhost/health` | `HTTP/1.1 200 OK` with `{"status":"ok","container":"<hostname>"}` |
| 2 | Create & Read Tasks | `curl -X POST http://localhost/api/tasks ...` | HTTP `201 Created` with task details and persisted records |
| 3 | Port Exposure Audit | `ss -tulnp` on Host | Only port `80` (and SSH `22`) open. `3000` & `5432` never visible |
| 4 | Network Isolation Proof | `docker compose exec proxy ping -c 2 db` | Fails with `bad address 'db'`, confirming proxy cannot route to DB |
| 5 | Non-Root Container Audit | `docker compose exec api id` | Returns `uid=1000(node) gid=1000(node)` |
| 6 | Container Health States | `docker compose ps` | All 3 containers report `Up (healthy)` |
| 7 | Zero-Key S3 Backup | `./scripts/backup-db.sh` | Uploads `.sql.gz` to S3 bucket without `.aws/credentials` |
| 8 | Disaster Recovery Drill | `docker compose down -v` then restore | Recreated empty DB successfully restores all tasks from S3 archive |
| 9 | Git Hygiene | `git status` | Clean status; `.env` ignored while `.env.example` tracked |
| 10 | Cloud Teardown Safety | AWS Console | Terminate EC2 and empty/delete S3 bucket to prevent unexpected charges |

---

## Quick Start (Local or EC2)

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url> ~/devops-capstone
   cd ~/devops-capstone
   ```
2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Set your DB_USER, DB_PASSWORD, and DB_NAME
   ```
3. **Launch the stack:**
   ```bash
   docker compose up -d --build
   ```
4. **Test the endpoints:**
   ```bash
   curl -s http://localhost/health
   curl -s -X POST http://localhost/api/tasks -H "Content-Type: application/json" -d '{"title":"Production Task #1"}'
   curl -s http://localhost/api/tasks
   ```
5. **Execute database backup:**
   ```bash
   ./scripts/backup-db.sh
   ```

For the complete implementation guide and AWS provisioning steps, refer to [docs/guide.md](file:///home/sandeep/Workspace/practice/docker-stack/docs/guide.md).

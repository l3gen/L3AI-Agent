# L3AI Agent — Drone Inspection Platform

A production-style AI inspection platform built to demonstrate the core architecture behind computer vision-powered drone inspection systems. Modeled after real-world platforms like Levatas that deploy on customer premises for industrial asset inspection.

---

## What It Does

Upload a drone image. The AI service analyzes it for thermal anomalies, corrosion signatures, and brightness irregularities. If the AI confidence score drops below 70%, the result is automatically routed to a human reviewer. A human inspects it and either approves or overrides the AI result.

That full loop — AI analysis → confidence check → human review → decision — is what real industrial inspection platforms run on drone footage from power plants, oil rigs, and infrastructure sites.

---

## Architecture

Four microservices, each running in its own Docker container and communicating over an internal Docker network:

```
┌─────────────────┐     ┌─────────────────┐
│  Dashboard      │     │  Ingestion API  │
│  React + nginx  │────▶│  Node.js        │
│  Port 3009      │     │  Port 5010      │
└─────────────────┘     └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼                           ▼
          ┌─────────────────┐       ┌─────────────────┐
          │  AI Service     │       │  Review Service  │
          │  Python + Flask │       │  Node.js         │
          │  Port 5011      │       │  Port 5012       │
          └─────────────────┘       └─────────────────┘
```

### Ingestion API (Node.js / Express)
Accepts image uploads from the dashboard. Stores inspection metadata, forwards the image to the AI service for analysis, and routes low-confidence results to the review queue. Exposes `/health`, `/inspections`, and `/upload` endpoints.

### AI Service (Python / Flask)
Performs real image analysis using NumPy and Pillow — no external API calls, runs fully offline. Three independent detection algorithms run on every image:

- **Thermal detection** — measures the red-to-blue channel ratio. High red relative to blue with a significant percentage of bright pixels indicates a thermal hot spot, the same way infrared imagery shows heat signatures.
- **Corrosion detection** — looks for orange-brown pixel clusters using color channel thresholds. Rust has a characteristic signature of high red, medium green, low blue.
- **Brightness analysis** — flags overexposed regions that can indicate fire, reflective surfaces, or camera malfunction.

Each analysis returns a severity level and feeds into a confidence score. Results also include GPU runtime detection — the service will report if CUDA is available and use it automatically.

### Review Service (Node.js / Express)
Human-in-the-loop queue. When the AI confidence falls below the threshold (default 70%), the ingestion API posts the result here. Human reviewers see it in the dashboard and either approve the AI result or override it as a false positive. Exposes `/queue`, `/queue/stats`, and approve/reject endpoints.

### Dashboard (React / Vite / nginx)
Three-tab interface — Upload, Inspections history, and Review queue. Shows confidence scores, thermal readings, hot pixel percentages, corrosion percentages, and recommendations for every inspection. Auto-refreshes every 5 seconds.

---

## Running Locally

**Requirements:** Docker Desktop, Node.js 20+

```bash
git clone https://github.com/l3gen/L3AI-Agent.git
cd L3AI-Agent

# Copy environment config
cp .env.example .env

# Start all 4 services
docker compose -p levatas-demo up --build

# Dashboard     → http://localhost:3009
# Ingestion API → http://localhost:5010
# AI Service    → http://localhost:5011
# Review Service→ http://localhost:5012
```

---

## Running Tests

With the services running:

```bash
# Smoke tests — hits every health endpoint and key API route
bash tests/smoke-test.sh

# Regression tests — full AI pipeline validation
node tests/regression.js
```

Expected output: all tests passing with 0 failures.

---

## CI/CD Pipeline

GitHub Actions pipeline with 3 jobs running on every push to `main`:

```
Push to main
     │
     ▼
┌─────────────────────────┐
│  Job 1: Test            │
│  - Spin up all services │
│  - Smoke tests          │
│  - Regression tests     │
└────────────┬────────────┘
             │ pass
             ▼
┌─────────────────────────┐
│  Job 2: Security Scan   │
│  - Trivy CVE scan       │
│  - CRITICAL/HIGH flags  │
│  - Upload SARIF results │
└────────────┬────────────┘
             │ pass
             ▼
┌─────────────────────────┐
│  Job 3: Build & Push    │
│  - Build all 4 images   │
│  - Tag with commit SHA  │
│  - Push to GHCR         │
└─────────────────────────┘
```

Images are tagged with both `latest` and `sha-<commit>`. The SHA tag is the rollback handle.

---

## Rollback

```bash
# List available image tags
./scripts/rollback.sh

# Roll back to a specific release
./scripts/rollback.sh sha-abc1234
```

The rollback script detects whether you're running Kubernetes or Docker Compose and handles both — `kubectl set image` for K8s, container restart for local.

---

## Kubernetes Deployment

Manifests are in `k8s/`. Designed for local Kubernetes with minikube or customer-hosted clusters. All images use `imagePullPolicy: Never` so they work in air-gapped environments without a public registry.

```bash
# Start minikube
minikube start --driver=docker

# Build images into minikube's Docker daemon
eval $(minikube docker-env)
docker compose build

# Deploy all services
kubectl apply -f k8s/

# Check pods
kubectl get pods -n levatas
```

---

## Secure Configuration

Secrets are never hardcoded. Environment variables are injected at runtime:

- **Local** — `.env` file (gitignored, see `.env.example`)
- **Kubernetes** — `k8s/secrets.yml` injected via `envFrom: secretRef`
- **CI** — GitHub Actions secrets

Docker images run as non-root users. The confidence threshold, service URLs, and all runtime config are environment-controlled so the same image runs identically across dev, staging, and customer-hosted environments.

---

## GPU Support

The AI service detects NVIDIA GPU runtime automatically at startup and logs the result. To enable GPU acceleration for production inference workloads:

```yaml
# In docker-compose.yml under ai-service
runtime: nvidia
environment:
  NVIDIA_VISIBLE_DEVICES: all
  NVIDIA_DRIVER_CAPABILITIES: compute,utility
```

Requires `nvidia-container-toolkit` installed on the host. No application code changes needed.

---

## Why This Architecture Matters

Industrial inspection companies deploy on customer premises — not public SaaS. The customer's data never leaves their network. That means the same software has to run identically on a power plant server in Texas, an oil rig in the North Sea, and an air-gapped government facility.

Every design decision here supports that: containerized services that run anywhere Docker runs, infrastructure defined as code, secrets injected at runtime, images tagged by commit SHA for precise rollback, and Kubernetes manifests that work without a cloud provider.

---

## Project Structure

```
├── ingestion-api/          Node.js image upload and routing service
├── ai-service/             Python image analysis engine
├── review-service/         Node.js human review queue
├── dashboard/              React inspection dashboard
├── k8s/                    Kubernetes manifests
├── tests/
│   ├── smoke-test.sh       API health and endpoint validation
│   └── regression.js       Full AI pipeline regression suite
├── scripts/
│   └── rollback.sh         Release rollback automation
├── .github/workflows/
│   └── ci.yml              GitHub Actions CI/CD pipeline
├── docker-compose.yml      Local orchestration
└── .env.example            Environment variable reference
```

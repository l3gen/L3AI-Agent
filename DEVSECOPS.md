# DevSecOps Guide — Levatas Demo

This document covers every security improvement made to this project, the reasoning behind each one, and what to study next to go deeper. Use it as both a reference and a learning roadmap.

---

## What DevSecOps Actually Means

DevSecOps is not a tool or a checklist. It is the practice of making security a shared responsibility across every stage of software delivery — code, build, deploy, and runtime — rather than a gate at the end.

The mental model: **shift left**. Every vulnerability you catch at the code-writing stage costs almost nothing to fix. The same vulnerability caught in production costs orders of magnitude more. DevSecOps means moving security checks as early in the pipeline as possible.

---

## The Threat Model for This Project

Before fixing anything, you need to understand what you are protecting and from whom. For this drone inspection platform:

**Assets**: Uploaded images, AI analysis results, the human review queue, and the container images themselves.

**Threats**: An external attacker uploading a malicious file, a compromised dependency introducing backdoor code, a misconfigured container giving root access to the host, a leaked secret in git history, or a rogue pod inside the cluster reaching services it should not touch.

Every fix below maps to one or more of these threats.

---

## What Was Fixed and Why

### 1. CI/CD Pipeline — Secret Scanning (Gitleaks)

**The gap**: No secret scanning. A developer could accidentally commit an API key, database password, or private key. Once committed, it exists in git history forever — even if deleted in a later commit.

**The fix**: Added Gitleaks as the very first job in the pipeline. It scans every commit in the full git history. If it finds a secret pattern, the entire pipeline stops before any tests run or images build.

**Why first**: There is no point building, testing, or scanning images if you are about to push an image that was built from a repo with a leaked credential. Secret leaks are catastrophic and irreversible once pushed to a public registry.

**Key concept**: Gitleaks works by matching regexes against file content. It knows about ~150 secret patterns out of the box — GitHub tokens, AWS keys, private key headers, etc. You can add custom patterns via `.gitleaks.toml` for your own internal token formats.

**To go deeper**: Study the difference between detecting secrets (Gitleaks, TruffleHog) versus preventing them (pre-commit hooks, vault-based workflows). The best posture is both: hooks block commits locally, CI catches anything that slips through.

---

### 2. CI/CD Pipeline — SAST with Semgrep

**The gap**: No static application security testing. The code was never analyzed for insecure patterns like SQL injection, command injection, insecure deserialization, or path traversal.

**The fix**: Added Semgrep with rule packs for Node.js, Python, Docker, and OWASP Top 10. Semgrep analyzes the AST (abstract syntax tree) of your code, not just regex patterns — so it understands code structure and catches things like `eval(userInput)` even if spread across lines.

**What Semgrep catches in this codebase**: In the ingestion-api it would flag `fs.readFileSync` for blocking the event loop, unvalidated file extension use, and wide-open CORS. In the ai-service it flags bare Flask `app.run()` without production guards.

**Key concept**: SAST ≠ linting. A linter catches style issues. SAST catches security issues by understanding data flow — it can trace user input from the HTTP request body all the way to a dangerous function call.

**To go deeper**: Learn the difference between SAST (static, no running code), DAST (dynamic, attacks a running app — tools like OWASP ZAP), and IAST (runtime instrumentation). Production-grade pipelines use all three.

---

### 3. CI/CD Pipeline — Dependency Auditing (npm audit, pip-audit)

**The gap**: Dependencies were installed but never audited for known CVEs. The `axios`, `multer`, and `express` packages each have had high-severity vulnerabilities in past versions.

**The fix**: Added `npm audit --audit-level=high` for all three Node.js services and `pip-audit -r requirements.txt --severity high` for the Python service. Both commands exit non-zero on findings at or above the threshold, blocking the build.

**Key concept**: Your application's attack surface includes every line of code in every package you install — and every package those packages install. `npm install` pulls in hundreds of transitive dependencies. You are responsible for all of them.

**Critical insight**: `npm install` and `npm ci` behave differently in a way that matters for security. `npm install` can silently upgrade patch versions and resolve version conflicts in ways that pull in different transitive deps than what was tested. `npm ci` installs exactly what is in `package-lock.json` — byte-for-byte reproducible. Always use `npm ci` in CI and production.

**To go deeper**: Study Software Bill of Materials (SBOM). An SBOM is a machine-readable inventory of every dependency in an artifact. Tools like Syft generate them; Grype can scan them. The US government now requires SBOMs for software sold to federal agencies (EO 14028).

---

### 4. CI/CD Pipeline — Trivy Container Scanning (Fixed)

**The gap**: Two issues. First, `exit-code: '0'` meant Trivy was finding vulnerabilities and reporting them but not blocking the build. The security scan was decorative. Second, the `review-service` image was never scanned at all.

**The fix**: Changed all Trivy steps to `exit-code: '1'` so the build fails on CRITICAL or HIGH findings. Added scans for all four images including `review-service` and `dashboard`.

**Key concept**: A security scan that doesn't block the pipeline is a report, not a control. Controls have teeth. If a CRITICAL vulnerability is acceptable to ship, you should have to explicitly override the check with a reason — not silently pass because the exit code was wrong.

**On image scanning**: Trivy scans two layers: OS packages (Alpine, Debian) and application-layer packages (node_modules, pip packages). Running on Alpine helps because Alpine has a much smaller OS package footprint than Debian or Ubuntu — fewer packages = smaller attack surface = fewer CVEs.

---

### 5. CI/CD Pipeline — Image Signing with Cosign

**The gap**: Images were built and pushed but there was no cryptographic proof they came from your pipeline. Anyone with write access to the registry (or a registry compromise) could push a malicious image with the same tag.

**The fix**: Added Cosign keyless signing using Sigstore. After each image push, Cosign signs it using an ephemeral key tied to the GitHub Actions OIDC identity. The signature is stored in the registry alongside the image.

**Key concept**: Image signing creates a chain of custody. Your Kubernetes cluster can be configured with policy (via Kyverno or OPA/Gatekeeper) to only admit images that have a valid signature from your CI pipeline. An unsigned or differently-signed image gets rejected at admission time — before it ever runs.

**Keyless signing**: Traditional signing uses a long-lived private key you have to manage and protect. Cosign keyless (Sigstore) uses short-lived certificates tied to your CI provider's OIDC token. No key management, fully auditable in the Sigstore transparency log.

---

### 6. Dockerfiles — Non-Root User

**The gap**: All containers ran as root (the default when no `USER` is set).

**The fix**: Added `RUN addgroup/adduser` and `USER appuser` to all Dockerfiles.

**Why this matters**: If an attacker exploits a vulnerability in your application and gets code execution inside the container, they get the privileges of the process. Root inside a container has dangerous implications — it can write to mounted volumes, interact with the Docker socket if mounted, and in some misconfigurations escape to the host. A non-root user with UID 1001 limits what the attacker can do even if they get in.

**Principle at work**: Least privilege. A process should have exactly the permissions it needs to do its job and no more.

---

### 7. Dockerfiles — Multi-Stage Builds

**The gap**: Single-stage builds meant the final image contained both production dependencies and build-time artifacts. For Node.js, this includes dev dependencies (testing frameworks, linters, build tools) that serve no purpose at runtime but add packages — and therefore CVEs — to the attack surface.

**The fix**: Two-stage builds. Stage 1 installs dependencies. Stage 2 copies only what's needed into a clean base image.

**The math**: A dev dependency like `jest` pulls in ~200 packages. None of those are needed in production. Multi-stage builds exclude them all from the final image, typically reducing image size by 30-60% and proportionally reducing the CVE surface.

**For Python**: The builder stage installs packages into `/install` using `--prefix`. The runtime stage copies only that directory into `/usr/local`. The build toolchain (gcc, etc.) never lands in the runtime image.

---

### 8. Dockerfiles — Gunicorn Instead of Flask Dev Server

**The gap**: The ai-service used `CMD ["python", "app.py"]` which runs Flask's built-in development server.

**The fix**: Switched to Gunicorn with 2 workers.

**Why**: Flask's dev server is single-threaded, single-process, and explicitly documented as not safe for production. It is designed for local development only. Gunicorn is a production WSGI server: it runs multiple worker processes, handles concurrent requests, has proper signal handling (graceful shutdown on SIGTERM), and does not expose debug information.

**To go deeper**: Study the difference between WSGI (Gunicorn, uWSGI) and ASGI (Uvicorn, Hypercorn). For async Python frameworks like FastAPI, you need ASGI. Flask is synchronous, so WSGI is correct here.

---

### 9. Kubernetes — securityContext

**The gap**: No `securityContext` on pods or containers. Kubernetes defaults are permissive: root user, all Linux capabilities, privilege escalation allowed, writable root filesystem.

**The fix**: Added both pod-level and container-level security contexts.

**Pod-level** (`spec.securityContext`):
- `runAsNonRoot: true` — Kubernetes itself rejects the pod if the image would run as root, before the container even starts.
- `runAsUser/runAsGroup: 1001` — explicit UID/GID, matches the user created in the Dockerfile.
- `seccompProfile: RuntimeDefault` — enables the container runtime's default seccomp profile, which blocks about 100 risky syscalls (ptrace, unshare, etc.) with essentially zero application impact.

**Container-level** (`containers[].securityContext`):
- `allowPrivilegeEscalation: false` — the process can never gain more privileges than it started with. No `sudo`, no setuid binaries.
- `readOnlyRootFilesystem: true` — the container's filesystem is mounted read-only. An attacker who gets code execution cannot write malware to disk, cannot modify application files, cannot create cron jobs. Combined with `emptyDir` volumes for paths that need write access (`/tmp`).
- `capabilities.drop: ["ALL"]` — removes all Linux capabilities. The default set includes `NET_RAW` (can forge packets), `SYS_CHROOT` (can chroot), and others an app server never needs.

**Seccomp deep dive**: Linux syscalls are the interface between user space and the kernel. There are ~400 of them. A typical Node.js app uses fewer than 50. Seccomp lets you define an allowlist. `RuntimeDefault` is Docker/containerd's maintained allowlist — a safe starting point. You can go further with custom profiles using tools like `inspektor-gadget` or `tracee` to record exactly which syscalls your app uses.

---

### 10. Kubernetes — NetworkPolicies

**The gap**: No NetworkPolicies. By default, Kubernetes uses a flat network — every pod can reach every other pod on any port.

**The fix**: Created `k8s/network-policies.yml` with a default-deny-all policy and explicit allow rules for only the traffic paths the architecture requires.

**Why this is critical**: Imagine the review-service has a vulnerability that gives an attacker a shell. Without NetworkPolicies, from inside that container they can reach the AI service, the ingestion API, the K8s API server, any cloud provider metadata endpoints (169.254.169.254 on AWS/GCP — which can return IAM credentials), and any other service in the cluster. With NetworkPolicies, that compromised pod is isolated to its allowed traffic only.

**How they work**: NetworkPolicies are enforced by the CNI plugin (Calico, Cilium, Weave). The policy spec has `podSelector` (which pods this applies to), `policyTypes` (Ingress, Egress, or both), and rules defining allowed sources/destinations. The default-deny policy with empty `podSelector: {}` matches all pods and blocks all traffic, then subsequent policies punch holes for specific paths.

**DNS exception**: Every policy that allows egress must explicitly allow UDP port 53, otherwise the pod cannot resolve service names and all internal calls fail. This is a common gotcha.

**To go deeper**: Study Cilium, which implements NetworkPolicies at the eBPF layer for better performance and adds L7 policy (you can write rules that allow `GET /health` but deny `POST /upload` at the network layer, not just the application layer).

---

### 11. Kubernetes — imagePullPolicy: Always

**The gap**: All deployments had `imagePullPolicy: Never`. This tells Kubernetes to use whatever image is cached locally and never pull from the registry.

**The fix**: Changed to `Always`.

**Why**: `Never` means a pod scheduled on a new node fails if the image isn't cached there. More importantly, it bypasses the pull — which means if you update an image in the registry (including security patches), the running pods never pick it up. `Always` ensures every pod creation pulls the current image.

**The tag problem**: Even with `Always`, using `:latest` is dangerous. If you deploy, then a new image is pushed with `:latest`, a pod restart pulls the new one — unintentionally. Use immutable SHA tags (the pipeline generates `sha-abc1234` tags) and update the deployment manifest explicitly. This gives you auditability: the manifest is version-controlled evidence of exactly which image version ran.

---

### 12. Application Code — CORS Restriction

**The gap**: `app.use(cors())` allows any origin. A malicious website could make authenticated requests to your API from a user's browser.

**The fix**: Explicit origin allowlist. Unknown origins are rejected. Configurable via `ALLOWED_ORIGINS` environment variable.

**Key concept**: CORS is a browser security feature — it does not protect server-to-server calls. Its purpose is to prevent a malicious webpage from using a visitor's browser session to make API calls your server would accept. If your API has no authentication, CORS has limited value. If it does, CORS is an important additional layer.

---

### 13. Application Code — File Type Validation

**The gap**: Multer only checked the `Content-Type` header, which a client can set to anything. A user could upload `evil.php` with `Content-Type: image/jpeg` and the API would accept it.

**The fix**: Two layers of validation. The `fileFilter` rejects disallowed MIME types at the header level. After saving, the code reads the first bytes of the file and checks them against known magic byte signatures for each allowed image type.

**Why magic bytes matter**: Every file format has a characteristic sequence of bytes at the start — the "magic bytes" or file signature. JPEG files start with `0xFF 0xD8 0xFF`. PNG starts with `0x89 0x50 0x4E 0x47`. A PHP file starts with `<?php`. Even if a file is named `evil.jpg`, you can tell what it actually is by reading the beginning. This makes it much harder to smuggle executable content into an image upload endpoint.

**Additional hardening**: UUIDs are used as filenames instead of the original filename. This prevents path traversal attacks (a filename like `../../etc/cron.d/backdoor`) and double-extension attacks (`evil.jpg.js` — some servers execute based on the last extension, others on the first).

---

### 14. Application Code — Rate Limiting

**The gap**: No rate limiting. Any client could flood `/upload` indefinitely.

**The fix**: `express-rate-limit` with a strict 20 uploads/minute limit on `/upload` and 200 requests/minute on all other routes.

**The threat**: Without rate limiting, an attacker can use your upload endpoint to exhaust disk space in `/tmp`, overwhelm the AI service with concurrent analysis requests, fill the in-memory `inspections` array until Node runs out of heap memory, and burn through any API credits if the AI service used a paid external API.

**To go deeper**: Production rate limiting should happen at the edge (CDN, load balancer, API gateway) before traffic reaches your application. `express-rate-limit` is a good defense-in-depth layer but can be bypassed by distributed IPs. Tools like Cloudflare Rate Limiting, AWS WAF, and Kong Gateway handle this at a higher level.

---

### 15. Application Code — Async File Read

**The gap**: `fs.readFileSync` blocks Node.js's event loop. During the time it takes to read a 20 MB image file from disk, Node cannot process any other requests — the server is effectively frozen for all clients.

**The fix**: `fs.readFile` with promisify (or `fs.promises.readFile`). The event loop is released while the OS reads the file, and Node can serve other requests in parallel.

**Key concept**: Node.js is single-threaded. Its concurrency model relies on never blocking the event loop — only async I/O and callbacks. Blocking calls like `readFileSync`, `execSync`, or CPU-intensive loops break this model and are a denial-of-service vulnerability under any meaningful load.

---

## What's Still Left To Add (Your Next Level)

### External Secrets Management
Kubernetes Secrets are base64-encoded, not encrypted. Anyone with `kubectl get secret -n levatas` access can read them. Use the External Secrets Operator with AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager to keep secrets out of the cluster entirely.

### OPA/Kyverno Admission Control
Policy-as-code for Kubernetes. Kyverno (simpler) or OPA Gatekeeper (more powerful) let you write cluster-wide rules: "no pod may run as root," "all images must come from ghcr.io/your-org," "all images must have a valid Cosign signature." These are enforced at admission time — rejected before they ever schedule.

### Runtime Security with Falco
Falco monitors kernel syscalls at runtime and alerts on suspicious behavior — a container spawning a shell, reading `/etc/passwd`, making an outbound network connection it shouldn't, writing to `/etc`. It is your intrusion detection system for Kubernetes workloads.

### DAST (Dynamic Application Security Testing)
OWASP ZAP or Nuclei can scan your running services for vulnerabilities — SQL injection, XSS, open redirects, misconfigured headers. Add a DAST job that spins up the services and runs ZAP against them before the build job.

### Security Headers
The Express API responses should include headers like `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, and `Content-Security-Policy`. Use the `helmet` package: `app.use(require('helmet')())`.

### Audit Logging
The review service approves and rejects AI decisions — but there is no audit trail. Who approved what, when, from which IP. In regulated industries (healthcare, energy infrastructure), this is a compliance requirement. Add structured logs with reviewer ID, timestamp, decision, and inspection ID on every approve/reject action.

### mTLS Between Services
Currently ingestion-api calls ai-service over plain HTTP inside the cluster. A compromised pod on the same network could intercept or spoof those calls. Mutual TLS (mTLS) means both sides present certificates — only services with valid certs can talk to each other. Istio and Linkerd implement this as a service mesh sidecar, transparent to your application code.

---

## The DevSecOps Maturity Model

Think of your current state and where to go using this scale:

**Level 1 — Reactive**: Security bugs found by users in production. No scanning in CI. Manual reviews.

**Level 2 — Aware** (where this project started): Trivy scanning in CI but not blocking. Basic secrets management guidance. 

**Level 3 — Proactive** (where this project is now): Secret scanning, SAST, dependency auditing, all blocking. Hardened containers and K8s. Secure-by-default application code.

**Level 4 — Preventive**: Policy-as-code (Kyverno/OPA) enforces standards cluster-wide. mTLS everywhere. External secrets. Admission controllers reject non-compliant workloads automatically.

**Level 5 — Continuous**: Runtime security (Falco). Chaos engineering includes security scenarios. Threat modeling is a standard part of design reviews. SBOMs generated and tracked across the fleet. Security metrics in the deployment dashboard.

---

## Key Terms Reference

| Term | What It Means |
|------|---------------|
| SAST | Static Application Security Testing — analyzes source code without running it |
| DAST | Dynamic Application Security Testing — attacks a running application |
| SBOM | Software Bill of Materials — inventory of all dependencies in an artifact |
| CVE | Common Vulnerabilities and Exposures — public database of known vulnerabilities |
| seccomp | Secure Computing Mode — Linux kernel feature to restrict syscalls |
| CORS | Cross-Origin Resource Sharing — browser policy controlling cross-origin requests |
| mTLS | Mutual TLS — both client and server authenticate with certificates |
| OPA | Open Policy Agent — policy-as-code engine for Kubernetes and APIs |
| OIDC | OpenID Connect — identity layer used for keyless signing in CI |
| Magic bytes | First bytes of a file that identify its true format |
| Shift left | Moving security checks earlier in the development lifecycle |
| Least privilege | A process/user has only the minimum permissions needed |
| Defense in depth | Multiple overlapping security controls so no single failure is catastrophic |

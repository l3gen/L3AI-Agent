# ── Stage 1: build/install ────────────────────────────────────────────────────
FROM python:3.11-slim AS builder
WORKDIR /app

# Install deps into a prefix directory — keeps the runtime image clean.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime
WORKDIR /app

# Patch all Debian base-image packages to latest security versions.
# Equivalent of apk upgrade for Alpine — fixes OS-level CVEs Trivy flags.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy installed packages from builder stage only
COPY --from=builder /install /usr/local

COPY app.py analyzer.py ./

USER appuser

EXPOSE 5001

# Use gunicorn in production instead of Flask dev server.
# Flask's built-in server is single-threaded and not hardened for production.
# gunicorn: multi-worker, handles concurrent requests, proper signal handling.
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "2", "--timeout", "60", "app:app"]

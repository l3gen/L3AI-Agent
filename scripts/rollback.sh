#!/bin/bash
# rollback.sh — Roll back all services to a previous image tag
# Usage:
#   ./scripts/rollback.sh sha-abc1234          # roll back to specific SHA
#   ./scripts/rollback.sh                      # list available tags

REGISTRY="ghcr.io"
IMAGE_PREFIX="${REGISTRY}/${IMAGE_OWNER:-your-github-username}/levatas-demo"
SERVICES=("ingestion-api" "ai-service" "review-service" "dashboard")

if [ -z "$1" ]; then
  echo ""
  echo "Usage: ./scripts/rollback.sh <image-tag>"
  echo ""
  echo "Available tags (from docker images):"
  docker images --format "{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" \
    | grep "levatas-demo" | sort -k2 -r | head -20
  echo ""
  exit 0
fi

TARGET_TAG="$1"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Rolling back to: $TARGET_TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# In Kubernetes — update image tag for each deployment
if kubectl cluster-info &>/dev/null 2>&1; then
  echo "Kubernetes cluster detected — rolling back deployments..."
  for service in "${SERVICES[@]}"; do
    IMAGE="${IMAGE_PREFIX}-${service}:${TARGET_TAG}"
    echo "  → $service: $IMAGE"
    kubectl set image deployment/${service} ${service}=${IMAGE} -n levatas 2>/dev/null \
      && echo "    ✅ Updated" \
      || echo "    ⚠️  Deployment not found (skipping)"
  done
  echo ""
  echo "Waiting for rollout..."
  for service in "${SERVICES[@]}"; do
    kubectl rollout status deployment/${service} -n levatas --timeout=60s 2>/dev/null || true
  done
else
  # Local Docker Compose fallback
  echo "No Kubernetes cluster — rolling back via Docker Compose..."
  export IMAGE_TAG="$TARGET_TAG"
  export IMAGE_PREFIX="$IMAGE_PREFIX"
  docker-compose down
  for service in "${SERVICES[@]}"; do
    docker pull "${IMAGE_PREFIX}-${service}:${TARGET_TAG}" 2>/dev/null || \
      echo "  ⚠️  Could not pull ${service}:${TARGET_TAG} — using local image"
  done
  docker-compose up -d
fi

echo ""
echo "✅ Rollback complete → $TARGET_TAG"
echo ""

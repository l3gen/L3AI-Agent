{{/*
Full image reference — registry/image:tag
Usage: {{ include "levatas.image" (dict "image" .Values.aiService.image "root" .) }}
*/}}
{{- define "levatas.image" -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .image .root.Values.image.tag -}}
{{- end }}

{{/*
Common labels applied to all resources
*/}}
{{- define "levatas.labels" -}}
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Standard readiness probe on /health
Usage: {{ include "levatas.readinessProbe" (dict "port" 5000) }}
*/}}
{{- define "levatas.readinessProbe" -}}
readinessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  initialDelaySeconds: 8
  periodSeconds: 5
  failureThreshold: 3
{{- end }}

{{/*
Standard liveness probe on /health
*/}}
{{- define "levatas.livenessProbe" -}}
livenessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 3
{{- end }}

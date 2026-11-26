#!/usr/bin/env bash
# Deploy all 3 Google ADK 2.0 services to Google Cloud Run from source using root Dockerfile
set -euo pipefail
export CLOUDSDK_CONTEXT_AWARE_USE_CLIENT_CERTIFICATE=false
export CLOUDSDK_CONTEXT_AWARE_USE_ECP_HTTP_PROXY=false

# Automatically load local .env file if present (ignored by git)
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    if [[ ! "$key" =~ ^# && -n "$key" ]]; then
      value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\''"]//' -e 's/["'\''"]$//')
      export "$key=$value"
    fi
  done < .env
fi

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-your-gcp-project-id}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
EVERSTATE_CHAT_MODEL="${EVERSTATE_CHAT_MODEL:-gemini-3.8-flash}"
EVERSTATE_REASONING_MODEL="${EVERSTATE_REASONING_MODEL:-gemini-4-argon}"
BIGQUERY_DATASET="${BIGQUERY_DATASET:-everstate_telemetry}"
BIGQUERY_EVENTS_TABLE="${BIGQUERY_EVENTS_TABLE:-agent_logs}"
SPANNER_INSTANCE="${SPANNER_INSTANCE:-everstate-spanner}"
SPANNER_DATABASE="${SPANNER_DATABASE:-everstate_memory}"
EVERSTATE_CONSOLE_URL="${EVERSTATE_CONSOLE_URL:-http://localhost:8080}"
EVERSTATE_INTERVIEW_AGENT_URL="${EVERSTATE_INTERVIEW_AGENT_URL:-http://localhost:8081}"
EVERSTATE_RECALL_AGENT_URL="${EVERSTATE_RECALL_AGENT_URL:-http://localhost:8082}"
AUTH_ALLOWED_EMAILS="${AUTH_ALLOWED_EMAILS:-example.com,user@example.com}"
FIREBASE_API_KEY="${FIREBASE_API_KEY:-your_firebase_api_key_here}"
FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-your-project-id.firebaseapp.com}"
FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-your-project-id}"
FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-your-project-id.firebasestorage.app}"
FIREBASE_MESSAGING_SENDER_ID="${FIREBASE_MESSAGING_SENDER_ID:-123456789012}"
FIREBASE_APP_ID="${FIREBASE_APP_ID:-1:123456789012:web:your_app_id_here}"

# Identity-Aware Proxy (IAP) & Reverse Proxy Configuration
AUTH_IAP_ENABLED="${AUTH_IAP_ENABLED:-false}"
AUTH_IAP_AUDIENCE="${AUTH_IAP_AUDIENCE:-}"
AUTH_IAP_HEADER="${AUTH_IAP_HEADER:-x-goog-iap-jwt-assertion}"
AUTH_PROXY_URL="${AUTH_PROXY_URL:-}"

# Dedicated least-privilege runtime identities (one per service; see terraform/iam.tf)
UI_SERVICE_ACCOUNT="${UI_SERVICE_ACCOUNT:-everstate-console-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
INTERVIEW_SERVICE_ACCOUNT="${INTERVIEW_SERVICE_ACCOUNT:-everstate-interview-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
PREFERENCE_SERVICE_ACCOUNT="${PREFERENCE_SERVICE_ACCOUNT:-everstate-recall-sa@${PROJECT_ID}.iam.gserviceaccount.com}"

echo "================================================================================"
echo "  Deploying Google ADK 2.0 Multi-Agent Demo to Google Cloud Run"
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  Model:    ${EVERSTATE_CHAT_MODEL} (reasoning: ${EVERSTATE_REASONING_MODEL})"
echo "================================================================================"

echo ""
echo "[1/3] Deploying everstate-interview..."
gcloud run deploy everstate-interview \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${INTERVIEW_SERVICE_ACCOUNT}" \
  --source=. \
  --clear-base-image \
  --no-allow-unauthenticated \
  --set-env-vars="SERVICE_MODULE=src.interview_agent.server,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,EVERSTATE_CHAT_MODEL=${EVERSTATE_CHAT_MODEL},BIGQUERY_DATASET=${BIGQUERY_DATASET},BIGQUERY_EVENTS_TABLE=${BIGQUERY_EVENTS_TABLE},EVERSTATE_OFFLINE=false,AUTH_IAP_ENABLED=${AUTH_IAP_ENABLED},AUTH_IAP_AUDIENCE=${AUTH_IAP_AUDIENCE},AUTH_IAP_HEADER=${AUTH_IAP_HEADER},AUTH_PROXY_URL=${AUTH_PROXY_URL}" \
  --quiet

echo ""
echo "[2/3] Deploying everstate-recall..."
gcloud run deploy everstate-recall \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${PREFERENCE_SERVICE_ACCOUNT}" \
  --source=. \
  --clear-base-image \
  --no-allow-unauthenticated \
  --set-env-vars="SERVICE_MODULE=src.preference_agent.server,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,EVERSTATE_CHAT_MODEL=${EVERSTATE_CHAT_MODEL},BIGQUERY_DATASET=${BIGQUERY_DATASET},BIGQUERY_EVENTS_TABLE=${BIGQUERY_EVENTS_TABLE},SPANNER_INSTANCE=${SPANNER_INSTANCE},SPANNER_DATABASE=${SPANNER_DATABASE},EVERSTATE_OFFLINE=false,AUTH_IAP_ENABLED=${AUTH_IAP_ENABLED},AUTH_IAP_AUDIENCE=${AUTH_IAP_AUDIENCE},AUTH_IAP_HEADER=${AUTH_IAP_HEADER},AUTH_PROXY_URL=${AUTH_PROXY_URL}" \
  --quiet

echo ""
echo "[3/3] Deploying everstate-console..."
gcloud run deploy everstate-console \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${UI_SERVICE_ACCOUNT}" \
  --source=. \
  --clear-base-image \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --session-affinity \
  --min-instances=0 \
  --max-instances=1 \
  --set-env-vars="SERVICE_MODULE=src.ui_service.server,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,EVERSTATE_CHAT_MODEL=${EVERSTATE_CHAT_MODEL},EVERSTATE_REASONING_MODEL=${EVERSTATE_REASONING_MODEL},BIGQUERY_DATASET=${BIGQUERY_DATASET},BIGQUERY_EVENTS_TABLE=${BIGQUERY_EVENTS_TABLE},SPANNER_INSTANCE=${SPANNER_INSTANCE},SPANNER_DATABASE=${SPANNER_DATABASE},EVERSTATE_OFFLINE=false,EVERSTATE_CONSOLE_URL=${EVERSTATE_CONSOLE_URL},EVERSTATE_INTERVIEW_AGENT_URL=${EVERSTATE_INTERVIEW_AGENT_URL},EVERSTATE_RECALL_AGENT_URL=${EVERSTATE_RECALL_AGENT_URL},AUTH_ALLOWED_EMAILS=${AUTH_ALLOWED_EMAILS},FIREBASE_API_KEY=${FIREBASE_API_KEY},FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID},FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET},FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID},FIREBASE_APP_ID=${FIREBASE_APP_ID},AUTH_IAP_ENABLED=${AUTH_IAP_ENABLED},AUTH_IAP_AUDIENCE=${AUTH_IAP_AUDIENCE},AUTH_IAP_HEADER=${AUTH_IAP_HEADER},AUTH_PROXY_URL=${AUTH_PROXY_URL}" \
  --quiet

echo ""
echo "================================================================================"
echo "  All services deployed successfully!"
echo "================================================================================"

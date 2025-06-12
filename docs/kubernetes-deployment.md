# Kubernetes Deployment Guide

This guide explains how to deploy the Believe X AI Trading Bot on a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (e.g., EKS, GKE, AKS, or local minikube)
- kubectl CLI configured to connect to your cluster
- Helm 3.x installed
- Docker registry with access to push images
- All required API keys and credentials

## Step 1: Build and Push Docker Images

Update the image references in the Kubernetes manifests to point to your Docker registry:

```bash
# Set your Docker registry
export DOCKER_REGISTRY=your-registry.io/believe-x-trading-bot

# Build and push all images
for service in api-gateway x-monitoring trading-orchestrator notification-service ai-analysis model-training data-preprocessing; do
  docker build -t $DOCKER_REGISTRY/$service:latest ./services/$service
  docker push $DOCKER_REGISTRY/$service:latest
done
```

## Step 2: Create Kubernetes Namespace

```bash
kubectl create namespace trading-bot
```

## Step 3: Create Secrets

Store your sensitive information as Kubernetes secrets:

```bash
kubectl create secret generic api-keys \
  --namespace trading-bot \
  --from-literal=X_BEARER_TOKEN=your_x_bearer_token \
  --from-literal=GEMINI_API_KEY=your_gemini_api_key \
  --from-literal=TELEGRAM_BOT_TOKEN=your_telegram_bot_token \
  --from-literal=TELEGRAM_CHAT_ID=your_telegram_chat_id \
  --from-literal=SOLANA_PRIVATE_KEY=your_solana_private_key

kubectl create secret generic db-credentials \
  --namespace trading-bot \
  --from-literal=POSTGRES_USER=admin \
  --from-literal=POSTGRES_PASSWORD=secure_password
```

## Step 4: Deploy Infrastructure Components

Install PostgreSQL and Redis using Helm:

```bash
# Add Bitnami repository
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install PostgreSQL
helm install postgres bitnami/postgresql \
  --namespace trading-bot \
  --set auth.username=admin \
  --set auth.password=secure_password \
  --set auth.database=trading_bot \
  --set persistence.size=10Gi

# Install Redis
helm install redis bitnami/redis \
  --namespace trading-bot \
  --set auth.enabled=false \
  --set persistence.size=5Gi
```

## Step 5: Deploy Monitoring Stack

Install Prometheus and Grafana using Helm:

```bash
# Add Prometheus repository
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install Prometheus
helm install prometheus prometheus-community/prometheus \
  --namespace trading-bot \
  --set server.persistentVolume.size=10Gi

# Install Grafana
helm install grafana bitnami/grafana \
  --namespace trading-bot \
  --set admin.password=secure_password \
  --set persistence.size=5Gi
```

## Step 6: Apply Kubernetes Manifests

Apply the Kubernetes manifests for all microservices:

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/services
```

## Step 7: Configure Ingress (Optional)

If you want to expose the API Gateway or monitoring dashboards:

```bash
# Install NGINX Ingress Controller if needed
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace

# Apply Ingress resources
kubectl apply -f k8s/ingress.yaml
```

## Step 8: Verify Deployment

Check if all pods are running:

```bash
kubectl get pods -n trading-bot
```

## Scaling

To scale the services horizontally:

```bash
kubectl scale deployment x-monitoring --replicas=3 -n trading-bot
kubectl scale deployment ai-analysis --replicas=3 -n trading-bot
```

## Monitoring

Access Grafana for monitoring:

```bash
# Port forward to access Grafana
kubectl port-forward svc/grafana 3000:80 -n trading-bot
```

Then open http://localhost:3000 in your browser.

## Troubleshooting

Check logs for any service:

```bash
kubectl logs -f deployment/api-gateway -n trading-bot
kubectl logs -f deployment/ai-analysis -n trading-bot
```

## Upgrading

To upgrade a service:

```bash
# Build and push new image
docker build -t $DOCKER_REGISTRY/service-name:new-tag ./services/service-name
docker push $DOCKER_REGISTRY/service-name:new-tag

# Update the deployment
kubectl set image deployment/service-name container-name=$DOCKER_REGISTRY/service-name:new-tag -n trading-bot
``` 
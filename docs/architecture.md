# Architecture Overview

## System Architecture Diagram

The Believe X AI Trading Bot uses a microservices architecture with event-driven communication through Redis Pub/Sub. The diagram below illustrates the system components and their interactions.

## Components

1. **API Gateway**: Acts as the entry point for external requests and orchestrates communication between services.
2. **X Monitoring Service**: Polls the X API every 5 seconds to check for new posts from monitored accounts.
3. **AI Analysis Service**: Processes posts using Gemini 1.5 Pro for sentiment analysis and trading decisions.
4. **Trading Orchestrator**: Manages trade execution via Jupiter DEX on Solana.
5. **Notification Service**: Sends updates about monitoring and trading activities to Telegram.
6. **Model Training Service**: Improves AI models over time based on historical data and outcomes.
7. **Data Preprocessing Service**: Prepares data for AI analysis and model training.

## Data Flow

1. X Monitoring Service detects a new post and publishes it to the "new-posts" topic.
2. AI Analysis Service subscribes to "new-posts" topic, processes the post, and publishes results to "analysis-results".
3. Trading Orchestrator subscribes to "analysis-results" topic and executes trades based on analysis.
4. Notification Service subscribes to multiple topics and sends updates to Telegram.

## Infrastructure

- **Databases**: PostgreSQL for persistent storage, Redis for caching and message broker.
- **Containerization**: Docker for development and production.
- **Monitoring**: Prometheus for metrics collection and Grafana for visualization.
- **Orchestration**: Kubernetes for production deployment (optional).

## Network Topology

All services communicate internally through Redis Pub/Sub. The API Gateway is the only component exposed to the outside world, with other services isolated in an internal network.

## Security

- API keys and secrets stored securely as environment variables.
- Rate limiting implemented at the API Gateway.
- Encrypted communication between services.
- Regular security audits and dependency updates. 
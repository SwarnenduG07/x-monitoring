# Believe X AI Trading Bot

An AI-powered X (Twitter) monitoring and trading bot that uses Gemini 1.5 Pro for sentiment analysis and Solana for trading execution.

## Architecture

This project uses a modern monorepo structure with Turborepo for efficient builds and dependency management. It consists of the following services:

- **X Monitoring Service**: Monitors X accounts for new posts
- **AI Analysis Service**: Analyzes posts using Gemini 1.5 Pro to make trading decisions
- **Trading Orchestrator**: Executes trades based on analysis results
- **Notification Service**: Sends notifications via Telegram
- **API Gateway**: Provides a unified API for frontend applications

## Technology Stack

- **Backend**: Node.js, TypeScript, Express, FastAPI
- **AI**: Google Gemini 1.5 Pro API
- **Database**: PostgreSQL for data storage
- **Messaging**: Redis for pub/sub messaging
- **Deployment**: Docker Compose
- **Build System**: Turborepo

## Setup Instructions

1. Clone the repository
   ```bash
   git clone https://github.com/your-username/believe-x.git
   cd believe-x
   ```

2. Run the setup script (this will copy .env.example to .env, install dependencies, and initialize the database)
   ```bash
   npm run setup
   ```

3. Edit the .env file with your API keys and configuration
   ```bash
   # Edit .env with your API keys
   ```

4. Start the services using Docker Compose
   ```bash
   npm run docker:up
   ```

5. To stop the services
   ```bash
   npm run docker:down
   ```

## Development

### Workspace Structure

```
.
├── apps/                  # Application services
│   ├── x-monitoring/      # X monitoring service
│   ├── ai-analysis/       # AI analysis service
│   ├── trading-orchestrator/ # Trading execution service
│   ├── notification-service/ # Notification service
│   └── api-gateway/       # API gateway service
├── packages/              # Shared libraries
│   ├── database/          # Database layer with Prisma ORM
│   └── shared/            # Shared utilities and types
├── docker-compose.yml     # Docker compose configuration
├── turbo.json             # Turborepo configuration
└── package.json           # Root package.json
```

### Running Individual Services

To run services individually during development:

```bash
# X Monitoring Service
cd apps/x-monitoring
npm run dev

# AI Analysis Service
cd apps/ai-analysis
npm run dev

# Trading Orchestrator
cd apps/trading-orchestrator
npm run dev

# Notification Service
cd apps/notification-service
npm run dev

# API Gateway
cd apps/api-gateway
npm run dev
```

### Building the Project

To build all services:

```bash
npm run build
```

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `X_BEARER_TOKEN`: X API bearer token
- `GEMINI_API_KEY`: Google Gemini 1.5 Pro API key
- `SOLANA_PRIVATE_KEY`: Solana wallet private key
- `TELEGRAM_BOT_TOKEN`: Telegram bot token for notifications
- `X_ACCOUNTS_TO_MONITOR`: Comma-separated list of X accounts to monitor

## License

MIT 
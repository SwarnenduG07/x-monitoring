# X Monitoring Service

This service monitors X (Twitter) accounts for new tweets and sends them to the AI Analysis service for processing.

## Features

- Monitors X accounts with active subscriptions
- Fetches tweets using the official Twitter API v2
- Sends new tweets to the AI Analysis service for sentiment analysis
- Forwards analysis results to the Trade Bot service
- Supports simulation mode for testing

## Environment Variables

```
PORT=3000
MONITORING_INTERVAL=5000
TRADE_BOT_URL=http://localhost:3002
AI_ANALYSIS_URL=http://localhost:3003
API_GATEWAY_URL=http://localhost:3001
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_KEY_SECRET=your_twitter_api_key_secret
TWITTER_ACCESS_TOKEN=your_twitter_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_twitter_access_token_secret
DATABASE_URL=your_database_url
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/accounts` - Get all monitored accounts
- `POST /api/accounts` - Add a new account to monitor
- `GET /api/active-accounts` - Get accounts with active subscriptions
- `GET /api/subscriptions` - Get active subscriptions
- `GET /api/test-twitter-api` - Test Twitter API connection
- `GET /api/simulate-tweets/:username` - Generate simulated tweets for testing

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the service:
```bash
npm run build
```

3. Run the service:
```bash
npm start
```

## Development

```bash
npm run dev
```

## Flow

1. The service periodically fetches tweets from monitored accounts
2. New tweets are sent to the AI Analysis service
3. Analysis results are forwarded to the Trade Bot service
4. Trade Bot service can then make trading decisions based on the analysis 
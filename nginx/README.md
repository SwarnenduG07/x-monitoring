# Nginx Configuration Documentation

This document describes the Nginx configuration used as the API Gateway for the Believe X AI Trading Bot system.

## Overview

The Nginx server acts as the main API Gateway, handling routing and load balancing between microservices. It includes:

- Rate limiting
- Gzip compression
- Health checks
- Error handling
- Proxy configurations for microservices

## Service Routes

### X-Monitoring Service
- Base path: `/api/x-monitoring/`
- Rate limit: 10 requests/second with burst of 20
- Upstream server: x-monitoring:3000

### AI Analysis Service  
- Base path: `/api/ai-analysis/`
- Rate limit: 2 requests/second with burst of 5
- Upstream server: ai-analysis:8000
- Extended timeouts (60s) for AI processing

### Trade Bot Service
- Base path: `/api/trade-bot/`
- Rate limit: 10 requests/second with burst of 20
- Upstream server: trade-bot:3002

## Performance Optimizations

- Worker processes auto-scaled
- Epoll event model enabled
- Keep-alive connections (32 per upstream)
- Gzip compression for various content types
- TCP optimizations (tcp_nopush, tcp_nodelay)
- Sendfile enabled

## Security Features

- Rate limiting zones configured
- Client max body size limited to 10MB
- Proxy headers properly set
- Error responses in JSON format

## Monitoring

- Custom logging format including:
  - Request timing
  - Upstream connection timing
  - Header timing
  - Response timing
- Error logs with warn level
- Health check endpoint at `/health`

## Error Handling

- Custom JSON error responses for:
  - 404 Not Found
  - 500-504 Server Errors
- Consistent JSON format for all API responses

## Default Response

Base path (`/`) returns API information:

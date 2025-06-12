# Database Package

This package provides database access using Prisma ORM for the Believe X AI Trading Bot.

## Schema

The database schema includes the following models:

- `MonitoredAccount`: X accounts being monitored
- `Post`: Posts from monitored accounts
- `AnalysisResult`: AI analysis results for posts
- `Trade`: Trade execution records
- `Notification`: System notifications

## Usage

### Setup

1. Make sure you have a PostgreSQL database running
2. Set the `DATABASE_URL` environment variable in your `.env` file
3. Run the database migration:

```bash
cd packages/database
npm run db:push
```

### Using in services

```typescript
import { prisma } from '@believe-x/database';

// Example: Find all monitored accounts
const accounts = await prisma.monitoredAccount.findMany();

// Example: Create a new post
const post = await prisma.post.create({
  data: {
    postId: '123456789',
    accountId: 1,
    content: 'This is a post',
    postUrl: 'https://x.com/user/status/123456789',
    postedAt: new Date()
  }
});

// Example: Find analysis results with related post data
const results = await prisma.analysisResult.findMany({
  include: {
    post: true
  }
});
```

## Prisma Studio

To explore and modify your data with a visual interface:

```bash
npm run db:studio
```

This will open Prisma Studio in your browser at http://localhost:5555.

## Additional Scripts

- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Create and apply migrations
- `npm run db:reset` - Reset the database
- `npm run build` - Build the TypeScript code 
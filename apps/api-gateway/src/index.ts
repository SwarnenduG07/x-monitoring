import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createLogger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';
import axios from 'axios';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3001;
const X_MONITORING_URL = process.env.X_MONITORING_URL || 'http://localhost:3000';

// Initialize services
const app = express();
const logger = createLogger('api-gateway');

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: {
        postedAt: 'desc'
      },
      include: {
        account: true
      },
      take: 50
    });
    
    res.json(posts);
  } catch (error) {
    logger.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const post = await prisma.post.findUnique({
      where: {
        id: postId
      },
      include: {
        account: true,
        analyses: true
      }
    });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json(post);
  } catch (error) {
    logger.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await prisma.monitoredAccount.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(accounts);
  } catch (error) {
    logger.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    // Forward the request to the X monitoring service
    try {
      const response = await axios.post(`${X_MONITORING_URL}/api/accounts`, { username });
      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('Error forwarding request to X monitoring service:', error);
      res.status(500).json({ error: 'Failed to add account' });
    }
  } catch (error) {
    logger.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// New endpoint to get telegram users
app.get('/api/telegram-users', async (req, res) => {
  try {
    const users = await prisma.telegramUser.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(users);
  } catch (error) {
    logger.error('Error fetching telegram users:', error);
    res.status(500).json({ error: 'Failed to fetch telegram users' });
  }
});

// New endpoint to get user subscriptions
app.get('/api/user-subscriptions', async (req, res) => {
  try {
    const { userId, tokenSymbol, accountId, active } = req.query;
    
    const whereClause: any = {};
    
    if (userId) {
      whereClause.userId = parseInt(userId as string);
    }
    
    if (tokenSymbol) {
      whereClause.tokenSymbol = tokenSymbol as string;
    }
    
    if (accountId) {
      whereClause.accountId = parseInt(accountId as string);
    }
    
    if (active !== undefined) {
      whereClause.active = active === 'true';
    }
    
    const subscriptions = await prisma.userSubscription.findMany({
      where: whereClause,
      include: {
        user: true,
        account: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(subscriptions);
  } catch (error) {
    logger.error('Error fetching user subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch user subscriptions' });
  }
});

// New endpoint to create a user subscription
app.post('/api/user-subscriptions', async (req, res) => {
  try {
    const { telegramId, xUsername, tokenSymbol } = req.body;
    
    if (!telegramId || !xUsername || !tokenSymbol) {
      return res.status(400).json({ error: 'Telegram ID, X username, and token symbol are required' });
    }
    
    // Find or create telegram user
    const user = await prisma.telegramUser.findUnique({
      where: { telegramId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Telegram user not found' });
    }
    
    // Find or create X account
    try {
      // First, check if account exists
      let account = await prisma.monitoredAccount.findFirst({
        where: { xUsername }
      });
      
      // If account doesn't exist, create it
      if (!account) {
        // Forward the request to the X monitoring service
        const response = await axios.post(`${X_MONITORING_URL}/api/accounts`, { username: xUsername });
        account = response.data;
      }
      
      // Check if subscription already exists
      const existingSubscription = await prisma.userSubscription.findFirst({
        where: {
          userId: user.id,
          accountId: account!.id,
          tokenSymbol
        }
      });
      
      if (existingSubscription) {
        // If subscription exists but is inactive, activate it
        if (!existingSubscription.active) {
          const updatedSubscription = await prisma.userSubscription.update({
            where: { id: existingSubscription.id },
            data: { active: true }
          });
          
          return res.status(200).json(updatedSubscription);
        }
        
        return res.status(200).json(existingSubscription);
      }
      
      // Create new subscription
      const subscription = await prisma.userSubscription.create({
        data: {
          userId: user.id,
          accountId: account!.id,
          tokenSymbol
        }
      });
      
      res.status(201).json(subscription);
    } catch (error) {
      logger.error('Error creating subscription:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  } catch (error) {
    logger.error('Error creating user subscription:', error);
    res.status(500).json({ error: 'Failed to create user subscription' });
  }
});

// New endpoint to update a user subscription
app.put('/api/user-subscriptions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { active } = req.body;
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid subscription ID' });
    }
    
    if (active === undefined) {
      return res.status(400).json({ error: 'Active status is required' });
    }
    
    const subscription = await prisma.userSubscription.update({
      where: { id },
      data: { active }
    });
    
    res.json(subscription);
  } catch (error) {
    logger.error('Error updating user subscription:', error);
    res.status(500).json({ error: 'Failed to update user subscription' });
  }
});

// New endpoint to delete a user subscription
app.delete('/api/user-subscriptions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid subscription ID' });
    }
    
    // Instead of deleting, mark as inactive
    const subscription = await prisma.userSubscription.update({
      where: { id },
      data: { active: false }
    });
    
    res.json(subscription);
  } catch (error) {
    logger.error('Error deleting user subscription:', error);
    res.status(500).json({ error: 'Failed to delete user subscription' });
  }
});

app.get('/api/analyses', async (req, res) => {
  try {
    const analyses = await prisma.analysisResult.findMany({
      orderBy: {
        processedAt: 'desc'
      },
      include: {
        post: {
          include: {
            account: true
          }
        }
      },
      take: 50
    });
    
    res.json(analyses);
  } catch (error) {
    logger.error('Error fetching analyses:', error);
    res.status(500).json({ error: 'Failed to fetch analyses' });
  }
});

app.get('/api/trades', async (req, res) => {
  try {
    const trades = await prisma.trade.findMany({
      orderBy: {
        executedAt: 'desc'
      },
      include: {
        analysis: true
      },
      take: 50
    });
    
    res.json(trades);
  } catch (error) {
    logger.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

app.use(express.static('public'));

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
}); 
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createLogger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3001;

// Initialize services
const app = express();
const logger = createLogger('api-gateway');

// Middleware
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

// API routes for posts
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
    const { xAccountId, xUsername, displayName } = req.body;
    
    if (!xAccountId || !xUsername) {
      return res.status(400).json({ error: 'X account ID and username are required' });
    }
    
    const existingAccount = await prisma.monitoredAccount.findUnique({
      where: {
        xAccountId
      }
    });
    
    if (existingAccount) {
      return res.status(409).json({ error: 'Account already exists' });
    }
    
    const account = await prisma.monitoredAccount.create({
      data: {
        xAccountId,
        xUsername,
        displayName
      }
    });
    
    res.status(201).json(account);
  } catch (error) {
    logger.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
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
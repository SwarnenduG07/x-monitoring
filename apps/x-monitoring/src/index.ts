import dotenv from 'dotenv';
import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { createRedisService, createLogger, XPost, RedisTopic } from '@believe-x/shared';
import { prisma } from '@believe-x/database';


dotenv.config();

const PORT = process.env.PORT || 3000;
const MONITORING_INTERVAL = parseInt(process.env.MONITORING_INTERVAL || '5000', 10);
const X_ACCOUNTS_TO_MONITOR = (process.env.X_ACCOUNTS_TO_MONITOR || '').split(',').filter(Boolean);


const app = express();
const logger = createLogger('x-monitoring');
const redisService = createRedisService();
const twitterClient = new TwitterApi(process.env.X_BEARER_TOKEN || '');
const readOnlyClient = twitterClient.readOnly;


const latestPostIds = new Map<string, string>();


app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});


app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await prisma.monitoredAccount.findMany();
    res.json(accounts);
  } catch (error) {
    logger.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

app.post('/api/accounts', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  try {
    const userResult = await readOnlyClient.v2.userByUsername(username);
    const user = userResult.data;

    const account = await prisma.monitoredAccount.create({
      data: {
        xAccountId: user.id,
        xUsername: user.username,
        displayName: user.name
      }
    });
    
    res.status(201).json(account);
  } catch (error) {
    logger.error('Error adding account:', error);
    res.status(500).json({ error: 'Failed to add account' });
  }
});


async function monitorAccounts() {
  try {
    logger.info('Starting monitoring cycle');
    
    const accounts = await prisma.monitoredAccount.findMany();
    
    for (const account of accounts) {
      const timer = logger.startTimer(`fetch_tweets_${account.xUsername}`);
      
      try {
        const tweetsResult = await readOnlyClient.v2.userTimeline(account.xAccountId, {
          max_results: 10,
          exclude: ['retweets', 'replies'],
          'tweet.fields': ['created_at', 'id', 'text'],
          'user.fields': ['id', 'name', 'username']
        });
        
        const tweets = tweetsResult.data.data || [];
        
        if (tweets.length > 0) {
          const latestTweetId = latestPostIds.get(account.xAccountId);
          const newTweets = latestTweetId 
            ? tweets.filter(tweet => tweet.id > latestTweetId)
            : tweets;
          
          if (tweets.length > 0) {
            latestPostIds.set(account.xAccountId, tweets[0].id);
          }
          
          for (const tweet of newTweets) {
            const post: XPost = {
              id: tweet.id,
              text: tweet.text,
              authorId: account.xAccountId,
              authorUsername: account.xUsername,
              authorDisplayName: account.displayName || account.xUsername,
              createdAt: tweet.created_at || new Date().toISOString(),
              url: `https://x.com/${account.xUsername}/status/${tweet.id}`
            };
            
            const savedPost = await prisma.post.create({
              data: {
                postId: post.id,
                accountId: account.id,
                content: post.text,
                postUrl: post.url,
                postedAt: new Date(post.createdAt)
              }
            });
            
            await redisService.publish(RedisTopic.NEW_POST, {
              postId: savedPost.id,
              postText: post.text,
              authorUsername: post.authorUsername,
              authorDisplayName: post.authorDisplayName,
              postUrl: post.url,
              timestamp: post.createdAt
            });
            
            logger.info(`New post detected from ${post.authorUsername}: ${post.text.substring(0, 50)}...`);
          }
        }
      } catch (error) {
        logger.error(`Error monitoring account ${account.xUsername}:`, error);
      } finally {
        timer();
      }
    }
  } catch (error) {
    logger.error('Error in monitoring cycle:', error);
  } finally {
    setTimeout(monitorAccounts, MONITORING_INTERVAL);
  }
}

app.listen(PORT, () => {
  logger.info(`X Monitoring Service running on port ${PORT}`);
  logger.info(`Monitoring interval: ${MONITORING_INTERVAL}ms`);
  logger.info(`Accounts to monitor: ${X_ACCOUNTS_TO_MONITOR.join(', ') || 'None (will load from database)'}`);
  

  monitorAccounts();
}); 
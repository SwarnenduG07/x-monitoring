import dotenv from 'dotenv';
import express from 'express';
import { Telegraf } from 'telegraf';
import { createLogger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';
import { setupBotCommands } from './commands';
import axios from 'axios';

dotenv.config();

const PORT = process.env.PORT || 3002;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3001';
const AI_ANALYSIS_URL = process.env.AI_ANALYSIS_URL || 'http://localhost:8000';
const X_MONITORING_URL = process.env.X_MONITORING_URL || 'http://localhost:3000';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const app = express();
const logger = createLogger('trade-bot');
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

setupBotCommands(bot, logger);

app.use(express.json());

app.post('/webhook/new-post', async (req, res) => {
  try {
    const { 
      postId, 
      postText, 
      authorUsername, 
      authorDisplayName, 
      postUrl, 
      timestamp,
      tokenInfo,
      subscribers 
    } = req.body;
    
    logger.info(`Received new post from @${authorUsername}: ${postText.substring(0, 50)}...`);
    
    // If tokenInfo is provided directly (from x-monitoring service)
    if (tokenInfo) {
      try {
        // Call AI analysis service directly
        const response = await axios.post(`${AI_ANALYSIS_URL}/api/analyze`, {
          postId,
          postText,
          authorUsername,
          authorDisplayName,
          postUrl,
          timestamp,
          tokenSymbols: [tokenInfo.symbol]
        });
        
        const analysis = response.data;
        
        // Format the analysis message
        const decisionEmoji = analysis.decision === 'buy' ? '🟢 BUY' : 
                            analysis.decision === 'sell' ? '🔴 SELL' : '⚪ HOLD';
        
        let tokenSentiment = 0;
        let tokenSentimentEmoji = '➖';
        
        // Get token-specific sentiment
        if (analysis.marketConditions?.relatedTokens) {
          const tokenData = analysis.marketConditions.relatedTokens.find(
            (t: any) => t.symbol === tokenInfo.symbol
          );
          
          if (tokenData) {
            tokenSentiment = tokenData.sentiment;
            tokenSentimentEmoji = tokenSentiment > 0.3 ? '📈' : 
                               tokenSentiment < -0.3 ? '📉' : '➖';
          }
        }
        
        // Format message with positive/negative signals
        const positiveSignals = analysis.reasons.positiveSignals
          .map((s: string) => `✅ ${s}`)
          .join('\n');
        
        const negativeSignals = analysis.reasons.negativeSignals
          .map((s: string) => `❌ ${s}`)
          .join('\n');
        
        const message = `
<b>${tokenInfo.symbol} Alert!</b>

@${authorUsername} tweeted:
"${postText.substring(0, 100)}${postText.length > 100 ? '...' : ''}"

<b>AI Analysis:</b> ${decisionEmoji} (Confidence: ${Math.round(analysis.confidence * 100)}%)
<b>Token Sentiment:</b> ${tokenSentimentEmoji} ${tokenSentiment.toFixed(2)}

${positiveSignals ? `<b>Positive Signals:</b>\n${positiveSignals}\n\n` : ''}
${negativeSignals ? `<b>Concerns:</b>\n${negativeSignals}\n\n` : ''}

<b>Token:</b> ${tokenInfo.address.substring(0, 8)}...${tokenInfo.address.substring(tokenInfo.address.length - 6)}

<a href="${postUrl}">View on X</a>
`;
        
        // Send notification to each subscribed user
        if (subscribers && subscribers.length > 0) {
          for (const telegramId of subscribers) {
            try {
              await bot.telegram.sendMessage(
                telegramId,
                message,
                { parse_mode: 'HTML' }
              );
              
              logger.info(`Analysis sent to user ${telegramId} for ${tokenInfo.symbol}`);
            } catch (error) {
              logger.error(`Failed to send message to user ${telegramId}:`, error);
            }
          }
        }
        
        // If decision is buy with high confidence, initiate trade
        if (analysis.decision === 'buy' && analysis.confidence >= 0.8) {
          logger.info(`High confidence buy signal for ${tokenInfo.symbol}, initiating trade`);
          
          // Call trading orchestrator directly (in a real system)
          // For now, just log that we would initiate a trade
          logger.info(`Would initiate trade for ${tokenInfo.symbol} based on analysis`);
        }
        
        res.status(200).json({ success: true, analysis });
        return;
      } catch (error) {
        logger.error(`Error analyzing post for ${tokenInfo.symbol}:`, error);
        res.status(500).json({ error: 'Error analyzing post' });
        return;
      }
    }
    
    // If no tokenInfo provided, fall back to database lookup
    try {
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { account: true }
      });
      
      if (!post) {
        logger.error(`Post not found: ${postId}`);
        return res.status(404).json({ error: 'Post not found' });
      }
      
      // Find all active subscriptions for this account
      const subscriptions = await prisma.userSubscription.findMany({
        where: {
          accountId: post.accountId,
          active: true
        },
        include: {
          user: true,
          token: true
        }
      });
      
      if (subscriptions.length === 0) {
        logger.info(`No active subscriptions for @${authorUsername}`);
        return res.status(200).json({ message: 'No active subscriptions' });
      }
      
      // Group subscriptions by token
      const tokenSubscriptions = new Map<number, { token: any, subscriptions: typeof subscriptions }>();
      
      for (const subscription of subscriptions) {
        if (!tokenSubscriptions.has(subscription.tokenId)) {
          tokenSubscriptions.set(subscription.tokenId, {
            token: subscription.token,
            subscriptions: []
          });
        }
        tokenSubscriptions.get(subscription.tokenId)!.subscriptions.push(subscription);
      }
      
      // For each token, analyze the post
      for (const [tokenId, data] of tokenSubscriptions.entries()) {
        const { token, subscriptions: subs } = data;
        
        try {
          // Call AI analysis service directly
          const response = await axios.post(`${API_GATEWAY_URL}/api/analyze`, {
            postId,
            postText,
            authorUsername,
            authorDisplayName,
            postUrl,
            timestamp,
            tokenSymbols: [token.symbol]
          });
          
          const analysis = response.data;
          
          // Format the analysis message
          const decisionEmoji = analysis.decision === 'buy' ? '🟢 BUY' : 
                              analysis.decision === 'sell' ? '🔴 SELL' : '⚪ HOLD';
          
          let tokenSentiment = 0;
          let tokenSentimentEmoji = '➖';
          
          // Get token-specific sentiment
          if (analysis.marketConditions?.relatedTokens) {
            const tokenData = analysis.marketConditions.relatedTokens.find(
              (t: any) => t.symbol === token.symbol
            );
            
            if (tokenData) {
              tokenSentiment = tokenData.sentiment;
              tokenSentimentEmoji = tokenSentiment > 0.3 ? '📈' : 
                                 tokenSentiment < -0.3 ? '📉' : '➖';
            }
          }
          
          // Format message with positive/negative signals
          const positiveSignals = analysis.reasons.positiveSignals
            .map((s: string) => `✅ ${s}`)
            .join('\n');
          
          const negativeSignals = analysis.reasons.negativeSignals
            .map((s: string) => `❌ ${s}`)
            .join('\n');
          
          const message = `
<b>${token.symbol} Alert!</b>

@${authorUsername} tweeted:
"${postText.substring(0, 100)}${postText.length > 100 ? '...' : ''}"

<b>AI Analysis:</b> ${decisionEmoji} (Confidence: ${Math.round(analysis.confidence * 100)}%)
<b>Token Sentiment:</b> ${tokenSentimentEmoji} ${tokenSentiment.toFixed(2)}

${positiveSignals ? `<b>Positive Signals:</b>\n${positiveSignals}\n\n` : ''}
${negativeSignals ? `<b>Concerns:</b>\n${negativeSignals}\n\n` : ''}

<b>Token:</b> ${token.address.substring(0, 8)}...${token.address.substring(token.address.length - 6)}

<a href="${postUrl}">View on X</a>
`;
          
          // Send notification to each subscribed user
          for (const subscription of subs) {
            try {
              await bot.telegram.sendMessage(
                subscription.user.telegramId,
                message,
                { parse_mode: 'HTML' }
              );
              
              logger.info(`Analysis sent to user ${subscription.user.telegramId} for ${token.symbol}`);
            } catch (error) {
              logger.error(`Failed to send message to user ${subscription.user.telegramId}:`, error);
            }
          }
          
          // If decision is buy with high confidence, initiate trade
          if (analysis.decision === 'buy' && analysis.confidence >= 0.8) {
            logger.info(`High confidence buy signal for ${token.symbol}, initiating trade`);
            
            // Call trading orchestrator directly (in a real system)
            // For now, just log that we would initiate a trade
            logger.info(`Would initiate trade for ${token.symbol} based on analysis`);
          }
        } catch (error) {
          logger.error(`Error analyzing post for ${token.symbol}:`, error);
        }
      }
      
      res.status(200).json({ success: true });
    } catch (dbError) {
      logger.error('Database error:', dbError);
      res.status(500).json({ error: 'Database error' });
    }
  } catch (error) {
    logger.error('Error processing new post webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

// Start the bot
bot.launch().then(() => {
  logger.info('Telegram bot started');
}).catch((error) => {
  logger.error('Failed to start Telegram bot:', error);
  process.exit(1);
});

// Start the express server
app.listen(PORT, () => {
  logger.info(`Telegram Bot Service running on port ${PORT}`);
});

// Enable graceful stop
process.once('SIGINT', () => {
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
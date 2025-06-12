import dotenv from 'dotenv';
import express from 'express';
import { Telegraf } from 'telegraf';
import { createRedisService, createLogger, NotificationMessage, RedisTopic, XPost } from '@believe-x/shared';
import { AnalysisResult, TradeResult, prisma } from '@believe-x/database';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3003;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Initialize services
const app = express();
const logger = createLogger('notification-service');
const redisService = createRedisService();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

// API endpoints
app.post('/api/notify', async (req, res) => {
  try {
    const notification: NotificationMessage = req.body;
    await sendNotification(notification);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// Send notification function
async function sendNotification(notification: NotificationMessage): Promise<void> {
  const timer = logger.startTimer('send_notification');
  
  try {
    // Format the message based on notification type
    let message = '';
    
    switch (notification.type) {
      case 'new_post':
        message = formatNewPostMessage(notification);
        break;
      case 'analysis_result':
        message = formatAnalysisResultMessage(notification);
        break;
      case 'trade_execution':
        message = formatTradeExecutionMessage(notification);
        break;
      case 'system_alert':
        message = formatSystemAlertMessage(notification);
        break;
      default:
        message = `${notification.title}\n\n${notification.message}`;
    }
    
    // Send to Telegram
    if (TELEGRAM_CHAT_ID) {
      await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
      logger.info(`Notification sent to Telegram: ${notification.title}`);
    } else {
      logger.info(`Notification (no Telegram chat ID):\n${message}`);
    }
    
    // Store in database
    await prisma.notification.create({
      data: {
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data ? notification.data : undefined
      }
    });
  } catch (error) {
    logger.error('Error sending notification:', error);
  } finally {
    timer();
  }
}

// Message formatters
function formatNewPostMessage(notification: NotificationMessage): string {
  const post = notification.data as XPost;
  return `📢 <b>New Post Detected</b>\n\n${post.authorDisplayName} (@${post.authorUsername}) posted:\n\n"${post.text}"\n\n<a href="${post.url}">View on X</a>`;
}

function formatAnalysisResultMessage(notification: NotificationMessage): string {
  const analysis = notification.data as AnalysisResult;
  
  // Format the reasons
  const reasons = analysis.reasons as any; // Cast to any to access properties
  const positiveReasons = reasons.positiveSignals.map((r: string) => `✅ ${r}`).join('\n');
  const negativeReasons = reasons.negativeSignals.map((r: string) => `❌ ${r}`).join('\n');
  
  let message = `💡 <b>AI Analysis Result</b>\n\n`;
  
  if (analysis.decision === 'buy' && analysis.confidence >= 0.8) {
    message += `🟢 <b>STRONG BUY</b> signal with ${Math.round(analysis.confidence * 100)}% confidence\n\n`;
  } else if (analysis.decision === 'buy') {
    message += `🟡 <b>BUY</b> signal with ${Math.round(analysis.confidence * 100)}% confidence\n\n`;
  } else if (analysis.decision === 'sell') {
    message += `🔴 <b>SELL</b> signal with ${Math.round(analysis.confidence * 100)}% confidence\n\n`;
  } else {
    message += `⚪ <b>HOLD</b> recommendation with ${Math.round(analysis.confidence * 100)}% confidence\n\n`;
  }
  
  message += `<b>Sentiment Score:</b> ${analysis.sentimentScore.toFixed(2)}\n\n`;
  
  if (positiveReasons) {
    message += `<b>Positive Signals:</b>\n${positiveReasons}\n\n`;
  }
  
  if (negativeReasons) {
    message += `<b>Concerns:</b>\n${negativeReasons}\n\n`;
  }
  
  if (analysis.marketConditions) {
    const marketConditions = analysis.marketConditions as any;
    
    if (marketConditions.overallMarketSentiment) {
      message += `<b>Market Sentiment:</b> ${marketConditions.overallMarketSentiment}\n\n`;
    }
    
    if (marketConditions.relatedTokens?.length) {
      message += `<b>Related Tokens:</b>\n`;
      marketConditions.relatedTokens.forEach((token: { symbol: string, sentiment: number }) => {
        const sentiment = token.sentiment > 0 ? '📈' : token.sentiment < 0 ? '📉' : '➖';
        message += `${sentiment} ${token.symbol}: ${token.sentiment.toFixed(2)}\n`;
      });
    }
  }
  
  return message;
}

function formatTradeExecutionMessage(notification: NotificationMessage): string {
  const trade = notification.data as TradeResult;
  
  let message = `🤖 <b>Trade Executed</b>\n\n`;
  
  if (trade.isPaperTrade) {
    message += `📝 <b>PAPER TRADE</b>\n\n`;
  } else {
    message += `💰 <b>REAL TRADE</b>\n\n`;
  }
  
  message += `<b>Token:</b> ${trade.tokenSymbol}\n`;
  message += `<b>Amount:</b> ${trade.tokenAmount.toFixed(6)}\n`;
  message += `<b>Price:</b> $${trade.priceUsd.toFixed(6)}\n`;
  message += `<b>Total Value:</b> $${(trade.tokenAmount * trade.priceUsd).toFixed(2)}\n\n`;
  
  if (trade.transactionHash) {
    message += `<b>Transaction:</b> <a href="https://solscan.io/tx/${trade.transactionHash}">View on Solscan</a>\n`;
  }
  
  message += `<b>Status:</b> ${trade.status.toUpperCase()}`;
  
  if (trade.errorMessage) {
    message += `\n<b>Error:</b> ${trade.errorMessage}`;
  }
  
  return message;
}

function formatSystemAlertMessage(notification: NotificationMessage): string {
  return `⚠️ <b>System Alert: ${notification.title}</b>\n\n${notification.message}`;
}

// Setup Redis subscribers
function setupRedisSubscribers() {
  // Subscribe to various Redis topics
  redisService.subscribe(RedisTopic.NEW_POST, (data: any) => {
    const notification: NotificationMessage = {
      type: 'new_post',
      title: 'New Post Detected',
      message: `New post from ${data.authorUsername}`,
      data,
      timestamp: new Date()
    };
    sendNotification(notification)
      .catch(error => {
        logger.error('Error in new post notification:', error);
      });
  });
  
  redisService.subscribe(RedisTopic.ANALYSIS_RESULT, (data: AnalysisResult) => {
    const notification: NotificationMessage = {
      type: 'analysis_result',
      title: 'Analysis Result',
      message: `Analysis completed for post ${data.postId}`,
      data,
      timestamp: new Date()
    };
    sendNotification(notification)
      .catch(error => {
        logger.error('Error in analysis notification:', error);
      });
  });
  
  redisService.subscribe(RedisTopic.TRADE_EXECUTION, (data: TradeResult) => {
    const notification: NotificationMessage = {
      type: 'trade_execution',
      title: 'Trade Executed',
      message: `Trade ${data.status} for ${data.tokenSymbol}`,
      data,
      timestamp: new Date()
    };
    sendNotification(notification)
      .catch(error => {
        logger.error('Error in trade notification:', error);
      });
  });
  
  redisService.subscribe(RedisTopic.NOTIFICATION, (data: NotificationMessage) => {
    sendNotification(data)
      .catch(error => {
        logger.error('Error in direct notification:', error);
      });
  });
  
  redisService.subscribe(RedisTopic.SYSTEM_ALERT, (data: any) => {
    const notification: NotificationMessage = {
      type: 'system_alert',
      title: data.title || 'System Alert',
      message: data.message || JSON.stringify(data),
      data,
      timestamp: new Date()
    };
    sendNotification(notification)
      .catch(error => {
        logger.error('Error in system alert notification:', error);
      });
  });
  
  logger.info('Redis subscribers set up for notification topics');
}

// Initialize Telegram bot
async function initializeBot() {
  try {
    // Set bot commands
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'status', description: 'Get system status' },
      { command: 'help', description: 'Get help' }
    ]);
    
    // Bot command handlers
    bot.command('start', async (ctx: any) => {
      await ctx.reply('👋 Welcome to the Believe X AI Trading Bot! I will send you notifications about new posts, analysis results, and trading activities.');
      logger.info(`Bot started by user ${ctx.from.id}`);
    });
    
    bot.command('status', async (ctx: any) => {
      await ctx.reply('⚙️ Systems operational. Monitoring X accounts and processing trading signals.');
      logger.info(`Status requested by user ${ctx.from.id}`);
    });
    
    bot.command('help', async (ctx: any) => {
      await ctx.reply('🔍 I monitor X accounts for new posts, analyze them with AI, and execute trades when signals are strong. You will receive notifications about each step of the process.');
      logger.info(`Help requested by user ${ctx.from.id}`);
    });
    
    // Start the bot
    await bot.launch();
    logger.info('Telegram bot started');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    logger.error('Error initializing Telegram bot:', error);
  }
}

// Start the server
app.listen(PORT, () => {
  logger.info(`Notification Service running on port ${PORT}`);
  
  // Initialize systems
  setupRedisSubscribers();
  initializeBot();
  
  // Send startup notification
  const startupNotification: NotificationMessage = {
    type: 'system_alert',
    title: 'System Startup',
    message: 'The Believe X AI Trading Bot has been started and is now monitoring X accounts.',
    timestamp: new Date()
  };
  sendNotification(startupNotification)
    .catch(error => {
      logger.error('Error sending startup notification:', error);
    });
}); 
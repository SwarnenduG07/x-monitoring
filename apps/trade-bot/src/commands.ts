import { Telegraf, Context } from 'telegraf';
import { createLogger, Logger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';
import axios from 'axios';

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3001';

const logger = createLogger('trade-bot');

export function setupBotCommands(bot: Telegraf, logger: Logger) {
  bot.start(async (ctx) => {
    try {
      const { id, username, first_name, last_name } = ctx.from;
      
      await prisma.telegramUser.upsert({
        where: { telegramId: id.toString() },
        update: {
          username: username || undefined,
          firstName: first_name,
          lastName: last_name || undefined,
        },
        create: {
          telegramId: id.toString(),
          username: username || undefined,
          firstName: first_name,
          lastName: last_name || undefined,
        }
      });
      
      await ctx.reply(
        `Welcome to Believe X Trading Bot! 🚀\n\n` +
        `I can help you monitor X (Twitter) accounts and execute trades based on their tweets.\n\n` +
        `Use /register TOKEN @handle to start monitoring an account.\n` +
        `Example: /register DOGE @elonmusk\n\n` +
        `Use /help to see all available commands.`
      );
      
      logger.info(`New user started the bot: ${id}`);
    } catch (error) {
      logger.error('Error in start command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Help command
  bot.help(async (ctx) => {
    await ctx.reply(
      `Available commands:\n\n` +
      `/register TOKEN @handle - Start monitoring an account for a specific token\n` +
      `/unregister TOKEN @handle - Stop monitoring an account for a specific token\n` +
      `/list - List all your active subscriptions\n` +
      `/status - Check the bot status\n` +
      `/help - Show this help message`
    );
  });
  
  // Register command
  bot.command('register', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Usage: /register TOKEN @handle\nExample: /register DOGE @elonmusk');
        return;
      }
      
      const tokenSymbol = args[0].toUpperCase();
      let xHandle = args[1];
      
      // Remove @ if present
      if (xHandle.startsWith('@')) {
        xHandle = xHandle.substring(1);
      }
      
      // Find the user
      const user = await prisma.telegramUser.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });
      
      if (!user) {
        await ctx.reply('Please start the bot with /start first.');
        return;
      }
      
      await ctx.reply(`Processing your request to monitor @${xHandle} for ${tokenSymbol}...`);
      
      try {
        // Use the API gateway to create the subscription
        const response = await axios.post(`${API_GATEWAY_URL}/api/user-subscriptions`, {
          telegramId: user.telegramId,
          xUsername: xHandle,
          tokenSymbol
        });
        
        if (response.status === 201) {
          // New subscription created
          await ctx.reply(`✅ Successfully registered to monitor @${xHandle} for ${tokenSymbol} tokens!`);
        } else {
          // Subscription already existed
          await ctx.reply(`✅ You are now monitoring @${xHandle} for ${tokenSymbol} tokens!`);
        }
        
        logger.info(`User ${user.id} registered to monitor @${xHandle} for ${tokenSymbol}`);
      } catch (error) {
        logger.error('Error registering subscription via API:', error);
        await ctx.reply('Sorry, I could not register your subscription. Please try again later.');
      }
    } catch (error) {
      logger.error('Error in register command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Unregister command
  bot.command('unregister', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Usage: /unregister TOKEN @handle\nExample: /unregister DOGE @elonmusk');
        return;
      }
      
      const tokenSymbol = args[0].toUpperCase();
      let xHandle = args[1];
      
      // Remove @ if present
      if (xHandle.startsWith('@')) {
        xHandle = xHandle.substring(1);
      }
      
      // Find the user
      const user = await prisma.telegramUser.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });
      
      if (!user) {
        await ctx.reply('Please start the bot with /start first.');
        return;
      }
      
      // Find the account
      const account = await prisma.monitoredAccount.findFirst({
        where: { xUsername: xHandle }
      });
      
      if (!account) {
        await ctx.reply(`Account @${xHandle} is not being monitored.`);
        return;
      }
      
      // Find the subscription
      const subscription = await prisma.userSubscription.findFirst({
        where: {
          userId: user.id,
          accountId: account.id,
          tokenSymbol,
          active: true
        }
      });
      
      if (!subscription) {
        await ctx.reply(`You are not monitoring @${xHandle} for ${tokenSymbol} tokens.`);
        return;
      }
      
      try {
        // Use the API gateway to update the subscription
        await axios.put(`${API_GATEWAY_URL}/api/user-subscriptions/${subscription.id}`, {
          active: false
        });
        
        await ctx.reply(`✅ Successfully unregistered from monitoring @${xHandle} for ${tokenSymbol} tokens.`);
        logger.info(`User ${user.id} unregistered from monitoring @${xHandle} for ${tokenSymbol}`);
      } catch (error) {
        logger.error('Error updating subscription via API:', error);
        await ctx.reply('Sorry, I could not update your subscription. Please try again later.');
      }
    } catch (error) {
      logger.error('Error in unregister command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // List command
  bot.command('list', async (ctx) => {
    try {
      // Find the user
      const user = await prisma.telegramUser.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });
      
      if (!user) {
        await ctx.reply('Please start the bot with /start first.');
        return;
      }
      
      try {
        // Use the API gateway to get the user's subscriptions
        const response = await axios.get(`${API_GATEWAY_URL}/api/user-subscriptions`, {
          params: {
            userId: user.id,
            active: true
          }
        });
        
        const subscriptions = response.data;
        
        if (subscriptions.length === 0) {
          await ctx.reply('You have no active subscriptions.');
          return;
        }
        
        let message = 'Your active subscriptions:\n\n';
        
        for (const sub of subscriptions) {
          message += `- ${sub.tokenSymbol} | @${sub.account.xUsername}\n`;
        }
        
        await ctx.reply(message);
      } catch (error) {
        logger.error('Error fetching subscriptions via API:', error);
        await ctx.reply('Sorry, I could not fetch your subscriptions. Please try again later.');
      }
    } catch (error) {
      logger.error('Error in list command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Status command
  bot.command('status', async (ctx) => {
    try {
      // Check API gateway health
      let apiGatewayStatus = '❌';
      try {
        const apiResponse = await axios.get(`${API_GATEWAY_URL}/health`);
        if (apiResponse.data.status === 'ok') {
          apiGatewayStatus = '✅';
        }
      } catch (error) {
        logger.error('API Gateway health check failed:', error);
      }
      
      // Check database health
      let dbStatus = '❌';
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = '✅';
      } catch (error) {
        logger.error('Database health check failed:', error);
      }
      
      await ctx.reply(
        `System Status:\n\n` +
        `Telegram Bot: ✅\n` +
        `API Gateway: ${apiGatewayStatus}\n` +
        `Database: ${dbStatus}\n\n` +
        `Bot is ${apiGatewayStatus === '✅' && dbStatus === '✅' ? 'fully operational' : 'experiencing issues'}.`
      );
    } catch (error) {
      logger.error('Error in status command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Handle unknown commands
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply('Unknown command. Use /help to see available commands.');
    }
  });
}

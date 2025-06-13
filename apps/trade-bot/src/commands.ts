import { Telegraf, Context } from 'telegraf';
import { createLogger, Logger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';
import axios from 'axios';
import { verifyTokenAddress, getTokenBySymbol } from './service/tken-service';
import { verifySolanaToken } from './service/solana-token-verification';

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
        `Use /register <token_address> @handle to start monitoring an account.\n` +
        `Example: /register 0x1234...abcd @elonmusk\n\n` +
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
      `/register <token_address> @handle - Start monitoring an account for a specific token\n` +
      `/unregister <token_address> @handle - Stop monitoring an account for a specific token\n` +
      `/list - List all your active subscriptions\n` +
      `/lookup <symbol> - Look up a token by symbol\n` +
      `/verify <token_address> - Verify a token address\n` +
      `/status - Check the bot status\n` +
      `/help - Show this help message`
    );
  });
  bot.command('register', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Usage: /register <token_address> @handle\nExample: /register Es9vMFrzaCERCLwKzHnh6mFYHTxgdRJrQbz6bG3y5QNo @elonmusk');
        return;
      }
      
      const tokenAddress = args[0].trim();
      let xHandle = args[1];
      
      // Remove @ if present
      if (xHandle.startsWith('@')) {
        xHandle = xHandle.substring(1);
      }
      
      // Find or create the user
      let user;
      try {
        user = await prisma.telegramUser.findUnique({
          where: { telegramId: ctx.from.id.toString() }
        });
        
        if (!user) {
          await ctx.reply('Please start the bot with /start first.');
          return;
        }
      } catch (dbError) {
        logger.error('Database error when finding user:', dbError);
        await ctx.reply('Database connection error. Please make sure your database is set up correctly.');
        return;
      }
      
      await ctx.reply(`Verifying Solana token address ${tokenAddress}...`);
      
      // Use our improved token verification
      const tokenInfo = await verifySolanaToken(tokenAddress);
      
      if (!tokenInfo) {
        await ctx.reply('❌ Invalid or unknown Solana token address. Please check the address and try again.');
        return;
      }
      
      if (!tokenInfo.market) {
        await ctx.reply(`⚠️ Warning: Token ${tokenInfo.symbol} doesn't appear to be actively traded on major DEXes. Continuing anyway...`);
      }
      
      await ctx.reply(`✅ Token verified: ${tokenInfo.symbol} (${tokenInfo.name || tokenInfo.symbol})\nProcessing your request to monitor @${xHandle}...`);
      
      try {
        // Check if database tables exist
        let tablesExist = true;
        try {
          await prisma.$queryRaw`SELECT * FROM "tokens" LIMIT 1`;
        } catch (error) {
          tablesExist = false;
          logger.error('Database tables do not exist:', error);
        }
        
        if (!tablesExist) {
          await ctx.reply(`✅ Token verified but database tables don't exist yet. Please run:\n\ncd packages/database && npm run db:push\n\nThen try registering again.`);
          return;
        }
        
        // Find or create the X account
        let account;
        try {
          account = await prisma.monitoredAccount.findFirst({
            where: { xUsername: xHandle }
          });
          
          if (!account) {
            // Create the account
            account = await prisma.monitoredAccount.create({
              data: {
                xAccountId: `placeholder_${xHandle}`, // We'll update this later when we actually fetch from X API
                xUsername: xHandle,
                displayName: xHandle
              }
            });
          }
        } catch (dbError) {
          logger.error('Database error when finding/creating account:', dbError);
          await ctx.reply('Error creating account in the database. Please check your database connection.');
          return;
        }
        
        // Find or create the token
        let token;
        try {
          token = await prisma.token.findFirst({
            where: { address: tokenAddress }
          });
          
          if (!token) {
            // Create the token
            token = await prisma.token.create({
              data: {
                address: tokenAddress,
                symbol: tokenInfo.symbol,
                name: tokenInfo.name,
                chainId: 1
              }
            });
          }
        } catch (dbError) {
          logger.error('Database error when finding/creating token:', dbError);
          await ctx.reply('Error creating token in the database. Please check your database connection.');
          return;
        }
        
        // Create or update the subscription
        try {
          // Check if subscription already exists
          const existingSubscription = await prisma.userSubscription.findFirst({
            where: {
              userId: user.id,
              accountId: account.id,
              tokenId: token.id
            }
          });
          
          if (existingSubscription) {
            if (!existingSubscription.active) {
              // Reactivate the subscription
              await prisma.userSubscription.update({
                where: { id: existingSubscription.id },
                data: { active: true }
              });
              
              await ctx.reply(`✅ Successfully reactivated your subscription to monitor @${xHandle} for ${tokenInfo.symbol} tokens!`);
            } else {
              await ctx.reply(`You are already monitoring @${xHandle} for ${tokenInfo.symbol} tokens.`);
            }
            return;
          }
          
          // Create new subscription
          await prisma.userSubscription.create({
            data: {
              userId: user.id,
              accountId: account.id,
              tokenId: token.id,
              active: true
            }
          });
          
          await ctx.reply(`✅ Successfully registered to monitor @${xHandle} for ${tokenInfo.symbol} tokens!`);
          logger.info(`User ${user.id} registered to monitor @${xHandle} for ${tokenInfo.symbol} (${tokenInfo.address})`);
        } catch (dbError) {
          logger.error('Database error when creating subscription:', dbError);
          await ctx.reply('Error creating subscription in the database. Please check your database connection.');
        }
      } catch (error) {
        logger.error('Error registering subscription:', error);
        await ctx.reply('Sorry, I could not register your subscription. Please try again later.');
      }
    } catch (error) {
      logger.error('Error in register command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Unregister command with token address
  bot.command('unregister', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Usage: /unregister <token_address> @handle\nExample: /unregister 0x1234...abcd @elonmusk');
        return;
      }
      
      const tokenAddress = args[0].trim();
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
      
      // Find the token
      const token = await prisma.token.findFirst({
        where: { address: tokenAddress }
      });
      
      if (!token) {
        await ctx.reply(`❌ Token not found with address: ${tokenAddress}`);
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
          tokenId: token.id,
          active: true
        }
      });
      
      if (!subscription) {
        await ctx.reply(`You are not monitoring @${xHandle} for ${token.symbol} tokens.`);
        return;
      }
      
      // Deactivate the subscription
      await prisma.userSubscription.update({
        where: { id: subscription.id },
        data: { active: false }
      });
      
      await ctx.reply(`✅ Successfully unregistered from monitoring @${xHandle} for ${token.symbol} tokens.`);
      logger.info(`User ${user.id} unregistered from monitoring @${xHandle} for ${token.symbol}`);
    } catch (error) {
      logger.error('Error in unregister command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // List command
  bot.command('list', async (ctx) => {
    try {
      const user = await prisma.telegramUser.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });
      
      if (!user) {
        await ctx.reply('Please start the bot with /start first.');
        return;
      }
      
      // Get user's subscriptions
      const subscriptions = await prisma.userSubscription.findMany({
        where: {
          userId: user.id,
          active: true
        },
        include: {
          account: true,
          token: true
        }
      });
      
      if (subscriptions.length === 0) {
        await ctx.reply('You have no active subscriptions.');
        return;
      }
      
      let message = 'Your active subscriptions:\n\n';
      
      for (const sub of subscriptions) {
        message += `- ${sub.token.symbol} | @${sub.account.xUsername}\n`;
        message += `  Token: ${sub.token.address.substring(0, 8)}...${sub.token.address.substring(sub.token.address.length - 6)}\n\n`;
      }
      
      await ctx.reply(message);
    } catch (error) {
      logger.error('Error in list command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Token lookup command
  bot.command('token', async (ctx) => {
    try {
      const symbol = ctx.message.text.split(' ')[1];
      
      if (!symbol) {
        await ctx.reply('Usage: /token <symbol>\nExample: /token DOGE');
        return;
      }
      
      const token = await getTokenBySymbol(symbol.toUpperCase());
      
      if (!token) {
        await ctx.reply(`No token found with symbol: ${symbol.toUpperCase()}`);
        return;
      }
      
      await ctx.reply(
        `Token Information:\n\n` +
        `Symbol: ${token.symbol}\n` +
        `Name: ${token.name || token.symbol}\n` +
        `Address: ${token.address}\n` +
        `Chain ID: ${token.chainId}\n` +
        `Decimals: ${token.decimals}`
      );
    } catch (error) {
      logger.error('Error in token command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Verify token command
  bot.command('verify', async (ctx) => {
    try {
      const address = ctx.message.text.split(' ')[1];
      
      if (!address) {
        await ctx.reply('Usage: /verify <token_address>\nExample: /verify 0x1234...abcd');
        return;
      }
      
      await ctx.reply(`Verifying token address ${address}...`);
      
      const token = await verifyTokenAddress(address);
      
      if (!token) {
        await ctx.reply(`❌ Invalid token address: ${address}`);
        return;
      }
      
      await ctx.reply(
        `✅ Token verified successfully!\n\n` +
        `Symbol: ${token.symbol}\n` +
        `Name: ${token.name || token.symbol}\n` +
        `Address: ${token.address}\n` +
        `Chain ID: ${token.chainId}\n` +
        `Decimals: ${token.decimals}`
      );
    } catch (error) {
      logger.error('Error in verify command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Status command
  bot.command('status', async (ctx) => {
    try {
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
        `Database: ${dbStatus}\n\n` +
        `Bot is ${dbStatus === '✅' ? 'fully operational' : 'experiencing issues'}.`
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

  bot.command('lookup', async (ctx) => {
    try {
      const symbol = ctx.message.text.split(' ')[1];
      
      if (!symbol) {
        await ctx.reply('Usage: /lookup <symbol>\nExample: /lookup USDC');
        return;
      }
      
      await ctx.reply(`Looking up token with symbol ${symbol.toUpperCase()}...`);
      
      try {
        // Try Jupiter API to find token by symbol
        const jupiterResponse = await axios.get('https://token.jup.ag/all');
        
        if (jupiterResponse.data && Array.isArray(jupiterResponse.data)) {
          const tokens = jupiterResponse.data.filter((t: any) => 
            t.symbol.toUpperCase() === symbol.toUpperCase());
          
          if (tokens.length > 0) {
            let message = `Found ${tokens.length} token(s) with symbol ${symbol.toUpperCase()}:\n\n`;
            
            for (let i = 0; i < Math.min(tokens.length, 5); i++) {
              const token = tokens[i];
              message += `${i+1}. ${token.symbol} (${token.name || 'Unknown'})\n`;
              message += `   Address: ${token.address}\n`;
              message += `   Decimals: ${token.decimals}\n\n`;
            }
            
            if (tokens.length > 5) {
              message += `...and ${tokens.length - 5} more\n\n`;
            }
            
            message += `To register, use:\n/register <token_address> @handle`;
            
            await ctx.reply(message);
            return;
          }
        }
        
        await ctx.reply(`No tokens found with symbol ${symbol.toUpperCase()}`);
      } catch (error) {
        logger.error('Error looking up token:', error);
        await ctx.reply('Sorry, I could not look up the token. Please try again later.');
      }
    } catch (error) {
      logger.error('Error in lookup command:', error);
      await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
}

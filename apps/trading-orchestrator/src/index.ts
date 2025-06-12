import dotenv from 'dotenv';
import express from 'express';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createJupiterApiClient  } from '@jup-ag/api';
import { createRedisService, createLogger, RedisTopic } from '@believe-x/shared';
import { prisma, AnalysisResult, TradeResult } from '@believe-x/database';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
dotenv.config();

// Constants
const PORT = process.env.PORT || 3002;
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.80');
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE || '0.05');
const MAX_PORTFOLIO_EXPOSURE = parseFloat(process.env.MAX_PORTFOLIO_EXPOSURE || '0.20');
const PAPER_TRADING_MODE = process.env.PAPER_TRADING_MODE === 'true';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Initialize services
const app = express();
const logger = createLogger('trading-orchestrator');
const redisService = createRedisService();

// Initialize Solana connection
const connection = new Connection(SOLANA_RPC_URL);

// Wallet setup
let wallet: Keypair | undefined;
if (!PAPER_TRADING_MODE && process.env.SOLANA_PRIVATE_KEY) {
  try {
    const privateKeyBytes = bs58.decode(process.env.SOLANA_PRIVATE_KEY);
    wallet = Keypair.fromSecretKey(privateKeyBytes);
    logger.info(`Wallet initialized: ${wallet.publicKey.toString()}`);
  } catch (error) {
    logger.error('Error initializing wallet:', error);
  }
}

// Token mapping (symbol to mint address)
const tokenMap: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  // Add more tokens as needed
};

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
app.get('/api/trades', async (req, res) => {
  try {
    const trades = await prisma.trade.findMany({
      orderBy: {
        executedAt: 'desc'
      },
      take: 50
    });
    res.json(trades);
  } catch (error) {
    logger.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Execute trade function
async function executeTrade(analysisResult: AnalysisResult): Promise<TradeResult | null> {
  const timer = logger.startTimer('execute_trade');
  
  try {
    // Skip if confidence is below threshold
    if (analysisResult.confidence < CONFIDENCE_THRESHOLD) {
      logger.info(`Skipping trade due to low confidence: ${analysisResult.confidence} < ${CONFIDENCE_THRESHOLD}`);
      return null;
    }
    
    // Only process "buy" decisions
    if (analysisResult.decision !== 'buy') {
      logger.info(`Skipping trade due to non-buy decision: ${analysisResult.decision}`);
      return null;
    }
    
    // Find token symbol mentioned in the analysis
    let tokenSymbol = 'SOL'; // Default to SOL
    if (analysisResult.marketConditions) {
      const marketConditions = analysisResult.marketConditions as any;
      if (marketConditions.relatedTokens?.length) {
        // Find the token with the highest sentiment
        const highestSentimentToken = marketConditions.relatedTokens.reduce(
          (prev: any, current: any) => (current.sentiment > prev.sentiment) ? current : prev
        );
        tokenSymbol = highestSentimentToken.symbol;
      }
    }
    
    // Check if token is supported
    if (!tokenMap[tokenSymbol]) {
      logger.info(`Unsupported token: ${tokenSymbol}`);
      return null;
    }
    
    // Calculate position size based on confidence
    const scaledConfidence = (analysisResult.confidence - CONFIDENCE_THRESHOLD) / (1 - CONFIDENCE_THRESHOLD);
    const positionSize = Math.min(MAX_POSITION_SIZE * scaledConfidence, MAX_POSITION_SIZE);
    const tradeAmountUSD = 1000 * positionSize; // Assuming $1000 as base trade amount
    
    logger.info(`Executing trade: ${tokenSymbol}, Amount: $${tradeAmountUSD.toFixed(2)}, Confidence: ${analysisResult.confidence}`);
    
    // For paper trading, just simulate the trade
    if (PAPER_TRADING_MODE || !wallet) {
      // Simulate trade execution
      const trade = await prisma.trade.create({
        data: {
          uuid: uuidv4(),
          analysisId: analysisResult.id,
          tokenSymbol: tokenSymbol,
          tokenAmount: 100,
          priceUsd: tradeAmountUSD / 100,
          isPaperTrade: true,
          status: 'completed'
        }
      });
      
      logger.info(`Paper trade executed: ${trade.id}`);
      
      return trade;
    } else {
      // Real trading using Jupiter
      try {
        // Create the trade record first
        const trade = await prisma.trade.create({
          data: {
            uuid: uuidv4(),
            analysisId: analysisResult.id,
            tokenSymbol: tokenSymbol,
            tokenAmount: 0,
            priceUsd: 0,
            isPaperTrade: false,
            status: 'pending'
          }
        });
        
        // Setup Jupiter
        const jupiter = await Jupiter.load({
          connection,
          cluster: 'mainnet-beta',
          user: wallet
        });
        
        // Calculate the amount of USDC to swap
        const inputToken = tokenMap['USDC'];
        const outputToken = tokenMap[tokenSymbol];
        
        // Find routes
        const routes = await jupiter.computeRoutes({
          inputMint: new PublicKey(inputToken),
          outputMint: new PublicKey(outputToken),
          amount: BigInt(tradeAmountUSD * 1000000), // USDC has 6 decimals
          slippageBps: 50 // 0.5% slippage
        });
        
        if (routes.routesInfos.length === 0) {
          logger.error(`No routes found for ${inputToken} to ${outputToken}`);
          
          // Update trade record
          await prisma.trade.update({
            where: { id: trade.id },
            data: {
              status: 'failed',
              errorMessage: 'No routes found'
            }
          });
          
          return null;
        }
        
        const bestRoute = routes.routesInfos[0];
        
        // Execute the swap
        const { execute } = await jupiter.exchange({
          routeInfo: bestRoute
        });
        
        const result = await execute();
        
        if (result.error) {
          logger.error(`Error executing trade: ${result.error}`);
          
          // Update trade record
          await prisma.trade.update({
            where: { id: trade.id },
            data: {
              status: 'failed',
              errorMessage: result.error.toString()
            }
          });
          
          return null;
        }
        
        // Update trade record with successful transaction
        const outputAmount = Number(bestRoute.outAmount) / 10 ** 9; // Assuming 9 decimals for most tokens
        const txid = result.txid;
        
        const updatedTrade = await prisma.trade.update({
          where: { id: trade.id },
          data: {
            tokenAmount: outputAmount,
            priceUsd: tradeAmountUSD / outputAmount,
            transactionHash: txid,
            status: 'completed'
          }
        });
        
        logger.info(`Real trade executed: ${updatedTrade.id}, txid: ${txid}`);
        
        return updatedTrade;
      } catch (error) {
        logger.error('Error executing real trade:', error);
        
        // Try to update the trade record if it was created
        try {
          await prisma.trade.update({
            where: { id: Number(analysisResult.id) }, // Convert to number if necessary
            data: {
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            }
          });
        } catch (dbError) {
          logger.error('Error updating trade record:', dbError);
        }
        
        return null;
      }
    }
  } catch (error) {
    logger.error('Error in executeTrade:', error);
    return null;
  } finally {
    timer();
  }
}

// Process analysis results
async function processAnalysisResult(analysisResult: AnalysisResult): Promise<void> {
  const timer = logger.startTimer('process_analysis');
  
  try {
    logger.info(`Processing analysis result for post ${analysisResult.postId}`);
    
    // Execute trade
    const tradeResult = await executeTrade(analysisResult);
    
    // Publish trade result to Redis if trade was executed
    if (tradeResult) {
      await redisService.publish(RedisTopic.TRADE_EXECUTION, tradeResult);
      logger.info(`Trade execution published: ${tradeResult.id}`);
    }
  } catch (error) {
    logger.error('Error processing analysis result:', error);
  } finally {
    timer();
  }
}

// Setup Redis subscriber
function setupRedisSubscriber() {
  redisService.subscribe(RedisTopic.ANALYSIS_RESULT, (data: AnalysisResult) => {
    processAnalysisResult(data)
      .catch(error => {
        logger.error('Error in analysis result handler:', error);
      });
  });
  
  logger.info('Redis subscriber initialized for analysis results');
}

// Start the server
app.listen(PORT, () => {
  logger.info(`Trading Orchestrator Service running on port ${PORT}`);
  logger.info(`Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
  logger.info(`Maximum position size: ${MAX_POSITION_SIZE * 100}%`);
  logger.info(`Maximum portfolio exposure: ${MAX_PORTFOLIO_EXPOSURE * 100}%`);
  logger.info(`Trading mode: ${PAPER_TRADING_MODE ? 'PAPER' : 'REAL'}`);
  
  // Initialize the Redis subscriber
  setupRedisSubscriber();
}); 
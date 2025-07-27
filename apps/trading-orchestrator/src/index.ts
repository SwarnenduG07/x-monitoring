import {
	type AnalysisResult,
	prisma,
	type Trade,
} from "@believe-x/database";
import {
	createLogger,
} from "@believe-x/shared";
import { createJupiterApiClient } from "@jup-ag/api";
import {
	Connection,
	Keypair,
	PublicKey,
	VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import express from "express";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

// Constants
const PORT = process.env.PORT || 3002;
const CONFIDENCE_THRESHOLD = parseFloat(
	process.env.CONFIDENCE_THRESHOLD || "0.80",
);
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE || "0.05");
const MAX_PORTFOLIO_EXPOSURE = parseFloat(
	process.env.MAX_PORTFOLIO_EXPOSURE || "0.20",
);
const PAPER_TRADING_MODE = process.env.PAPER_TRADING_MODE === "true";
const SOLANA_RPC_URL =
	process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Initialize services
const app = express();
const logger = createLogger("trading-orchestrator");

// Simple in-memory queue for demo purposes (replace with Redis in production)
const analysisQueue: AnalysisResult[] = [];

// Initialize Solana connection
const connection = new Connection(SOLANA_RPC_URL);

// Initialize Jupiter API client
const jupiterApi = createJupiterApiClient({
	basePath: process.env.JUPITER_API_ENDPOINT || "https://quote-api.jup.ag/v6",
});

// Wallet setup
let wallet: Keypair | undefined;
if (!PAPER_TRADING_MODE && process.env.SOLANA_PRIVATE_KEY) {
	try {
		const privateKeyBytes = bs58.decode(process.env.SOLANA_PRIVATE_KEY);
		wallet = Keypair.fromSecretKey(privateKeyBytes);
		logger.info(`Wallet initialized: ${wallet.publicKey.toString()}`);
	} catch (error) {
		logger.error("Error initializing wallet:", error);
	}
}

// Token mapping (symbol to mint address)
const tokenMap: Record<string, string> = {
	SOL: "So11111111111111111111111111111111111111112",
	USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
	BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
	WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
	PEPE: "BzQrdZcFkUCoHqSKkAGDxF8nqjSL9k49Mv9RV5g9nWdX",
	POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
	JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
	RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
	DRIFT: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7",
	RENDER: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
	// Add more tokens as needed
};

// Helper function to extract token symbols from text
function extractTokenSymbols(text: string): string[] {
	const tokenRegex = /\$([A-Z]{2,10})|#([A-Z]{2,10})|([A-Z]{2,10})\s*(?:token|coin|crypto)/gi;
	const matches = text.match(tokenRegex);
	const symbols = new Set<string>();
	
	if (matches) {
		for (const match of matches) {
			const symbol = match.replace(/[$#]/g, '').replace(/\s*(token|coin|crypto)/gi, '').trim().toUpperCase();
			if (tokenMap[symbol]) {
				symbols.add(symbol);
			}
		}
	}
	
	return Array.from(symbols);
}

// Portfolio risk management function
async function checkPortfolioRisk(tokenSymbol: string, tradeAmountUSD: number): Promise<boolean> {
	try {
		// Get recent trades from last 24 hours
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const recentTrades = await prisma.trade.findMany({
			where: {
				executedAt: {
					gte: oneDayAgo,
				},
				status: "completed",
			},
		});

		// Calculate total portfolio exposure
		const totalExposure = recentTrades.reduce((sum, trade) => {
			return sum + (trade.tokenAmount * trade.priceUsd);
		}, 0);

		// Calculate exposure for this specific token
		const tokenExposure = recentTrades
			.filter(trade => trade.tokenSymbol === tokenSymbol)
			.reduce((sum, trade) => sum + (trade.tokenAmount * trade.priceUsd), 0);

		// Check if adding this trade would exceed limits
		const newTotalExposure = totalExposure + tradeAmountUSD;
		const newTokenExposure = tokenExposure + tradeAmountUSD;

		const maxPortfolioValue = 10000; // $10k max portfolio
		const maxTokenValue = maxPortfolioValue * MAX_POSITION_SIZE;

		if (newTotalExposure > maxPortfolioValue * MAX_PORTFOLIO_EXPOSURE) {
			logger.warn(`Portfolio risk limit exceeded: ${newTotalExposure} > ${maxPortfolioValue * MAX_PORTFOLIO_EXPOSURE}`);
			return false;
		}

		if (newTokenExposure > maxTokenValue) {
			logger.warn(`Token position limit exceeded: ${newTokenExposure} > ${maxTokenValue}`);
			return false;
		}

		logger.info(`Portfolio risk check passed. Total: $${newTotalExposure}, Token (${tokenSymbol}): $${newTokenExposure}`);
		return true;
	} catch (error) {
		logger.error("Error checking portfolio risk:", error);
		return false; // Fail safe - don't trade if we can't check risk
	}
}

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", async (req, res) => {
	try {
		// Check database connection
		await prisma.$queryRaw`SELECT 1`;
		res.status(200).json({ status: "ok" });
	} catch (error) {
		logger.error("Health check failed", error);
		res
			.status(500)
			.json({ status: "error", message: "Database connection failed" });
	}
});

// API endpoints
app.get("/api/trades", async (req, res) => {
	try {
		const trades = await prisma.trade.findMany({
			orderBy: {
				executedAt: "desc",
			},
			take: 50,
			include: {
				analysis: {
					include: {
						post: {
							include: {
								account: true,
							},
						},
					},
				},
			},
		});
		res.json(trades);
	} catch (error) {
		logger.error("Error fetching trades:", error);
		res.status(500).json({ error: "Failed to fetch trades" });
	}
});

// Portfolio status endpoint
app.get("/api/portfolio", async (req, res) => {
	try {
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

		// Get trades from different time periods
		const [dailyTrades, weeklyTrades, allTrades] = await Promise.all([
			prisma.trade.findMany({
				where: {
					executedAt: { gte: oneDayAgo },
					status: "completed",
				},
			}),
			prisma.trade.findMany({
				where: {
					executedAt: { gte: oneWeekAgo },
					status: "completed",
				},
			}),
			prisma.trade.findMany({
				where: { status: "completed" },
				orderBy: { executedAt: "desc" },
				take: 100,
			}),
		]);

		// Calculate portfolio metrics
		const dailyValue = dailyTrades.reduce((sum, trade) => sum + (trade.tokenAmount * trade.priceUsd), 0);
		const weeklyValue = weeklyTrades.reduce((sum, trade) => sum + (trade.tokenAmount * trade.priceUsd), 0);
		const totalValue = allTrades.reduce((sum, trade) => sum + (trade.tokenAmount * trade.priceUsd), 0);

		// Token distribution
		const tokenDistribution = allTrades.reduce((acc, trade) => {
			const tokenValue = trade.tokenAmount * trade.priceUsd;
			acc[trade.tokenSymbol] = (acc[trade.tokenSymbol] || 0) + tokenValue;
			return acc;
		}, {} as Record<string, number>);

		// Trade statistics
		const successfulTrades = allTrades.filter(trade => trade.status === "completed").length;
		const failedTrades = await prisma.trade.count({ where: { status: "failed" } });

		const portfolio = {
			summary: {
				totalValue: totalValue.toFixed(2),
				dailyValue: dailyValue.toFixed(2),
				weeklyValue: weeklyValue.toFixed(2),
				totalTrades: allTrades.length,
				successfulTrades,
				failedTrades,
				successRate: ((successfulTrades / (successfulTrades + failedTrades)) * 100).toFixed(1),
			},
			tokenDistribution,
			recentTrades: allTrades.slice(0, 10),
		};

		res.json(portfolio);
	} catch (error) {
		logger.error("Error fetching portfolio:", error);
		res.status(500).json({ error: "Failed to fetch portfolio data" });
	}
});

// Manual analysis processing trigger endpoint
app.post("/api/process-analysis", async (req, res) => {
	try {
		const { analysisId } = req.body;
		
		if (analysisId) {
			// Process specific analysis
			const analysis = await prisma.analysisResult.findUnique({
				where: { id: Number(analysisId) },
			});
			
			if (!analysis) {
				return res.status(404).json({ error: "Analysis not found" });
			}
			
			logger.info(`Manually processing analysis ${analysisId}`);
			await processAnalysisResult(analysis);
			res.json({ message: "Analysis processed successfully", analysisId });
		} else {
			// Process all pending analyses
			const unprocessedAnalyses = await prisma.analysisResult.findMany({
				where: {
					trades: { none: {} },
					processedAt: {
						gte: new Date(Date.now() - 60 * 60 * 1000), // Last 1 hour
					},
				},
				take: 10,
			});
			
			logger.info(`Manually processing ${unprocessedAnalyses.length} pending analyses`);
			
			for (const analysis of unprocessedAnalyses) {
				await processAnalysisResult(analysis);
				await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
			}
			
			res.json({ 
				message: "All pending analyses processed", 
				processedCount: unprocessedAnalyses.length 
			});
		}
	} catch (error) {
		logger.error("Error in manual analysis processing:", error);
		res.status(500).json({ error: "Failed to process analysis" });
	}
});

// Execute trade function
async function executeTrade(
	analysisResult: AnalysisResult,
): Promise<Trade | null> {
	const timer = logger.startTimer("execute_trade");

	try {
		// Skip if confidence is below threshold
		if (analysisResult.confidence < CONFIDENCE_THRESHOLD) {
			logger.info(
				`Skipping trade due to low confidence: ${analysisResult.confidence} < ${CONFIDENCE_THRESHOLD}`,
			);
			return null;
		}

		// Only process "buy" decisions
		if (analysisResult.decision !== "buy") {
			logger.info(
				`Skipping trade due to non-buy decision: ${analysisResult.decision}`,
			);
			return null;
		}

		// Get the post content to extract token symbols
		const post = await prisma.post.findUnique({
			where: { id: analysisResult.postId },
		});

		if (!post) {
			logger.error(`Post not found for analysis ID: ${analysisResult.id}`);
			return null;
		}

		// Extract token symbols from post content
		let tokenSymbols = extractTokenSymbols(post.content);

		// Also check market conditions for related tokens
		if (analysisResult.marketConditions) {
			const marketConditions = analysisResult.marketConditions as any;
			if (marketConditions.relatedTokens?.length) {
				const relatedSymbols = marketConditions.relatedTokens
					.filter((token: any) => token.sentiment > 0.5 && tokenMap[token.symbol])
					.map((token: any) => token.symbol);
				tokenSymbols = [...new Set([...tokenSymbols, ...relatedSymbols])];
			}
		}

		// Default to SOL if no tokens found
		if (tokenSymbols.length === 0) {
			tokenSymbols = ["SOL"];
		}

		// Pick the first supported token for trading
		const tokenSymbol = tokenSymbols[0];

		logger.info(
			`Found tokens in analysis: ${tokenSymbols.join(", ")}, trading: ${tokenSymbol}`,
		);

		// Check if token is supported
		if (!tokenMap[tokenSymbol]) {
			logger.info(`Unsupported token: ${tokenSymbol}`);
			return null;
		}

		// Calculate position size based on confidence
		const scaledConfidence =
			(analysisResult.confidence - CONFIDENCE_THRESHOLD) /
			(1 - CONFIDENCE_THRESHOLD);
		const positionSize = Math.min(
			MAX_POSITION_SIZE * scaledConfidence,
			MAX_POSITION_SIZE,
		);
		const tradeAmountUSD = 100 * positionSize; // Base trade amount $100

		// Check portfolio risk before executing trade
		const riskCheckPassed = await checkPortfolioRisk(tokenSymbol, tradeAmountUSD);
		if (!riskCheckPassed) {
			logger.info(`Trade cancelled due to portfolio risk limits: ${tokenSymbol}`);
			return null;
		}

		logger.info(
			`Executing trade: ${tokenSymbol}, Amount: $${tradeAmountUSD.toFixed(2)}, Confidence: ${analysisResult.confidence}`,
		);

		// For paper trading, just simulate the trade
		if (PAPER_TRADING_MODE || !wallet) {
			// Get current price estimate for the token (simplified)
			const estimatedPrice = tokenSymbol === "SOL" ? 150 : 0.001; // Placeholder prices
			const estimatedTokenAmount = tradeAmountUSD / estimatedPrice;

			const trade = await prisma.trade.create({
				data: {
					uuid: uuidv4(),
					analysisId: analysisResult.id,
					tokenSymbol: tokenSymbol,
					tokenAmount: estimatedTokenAmount,
					priceUsd: estimatedPrice,
					isPaperTrade: true,
					status: "completed",
				},
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
						status: "pending",
					},
				});

				// Input and output tokens
				const inputToken = tokenMap["USDC"]; // Using USDC as base currency
				const outputToken = tokenMap[tokenSymbol];

				// Convert USD amount to USDC (6 decimals)
				const usdcAmount = Math.floor(tradeAmountUSD * 1000000);

				logger.info(
					`Getting Jupiter quote: ${tokenSymbol} for $${tradeAmountUSD} (${usdcAmount} USDC)`,
				);

				// 1. Get a quote for the swap
				const quoteResponse = await jupiterApi.quoteGet({
					inputMint: inputToken,
					outputMint: outputToken,
					amount: usdcAmount,
					slippageBps: 100, // 1% slippage
				});

				if (!quoteResponse) {
					logger.error(`No quote found for ${inputToken} to ${outputToken}`);

					await prisma.trade.update({
						where: { id: trade.id },
						data: {
							status: "failed",
							errorMessage: "No quote found",
						},
					});

					return null;
				}

				logger.info(
					`Jupiter quote received: ${quoteResponse.outAmount} tokens for ${usdcAmount} USDC`,
				);

				// 2. Get the swap transaction
				const swapResponse = await jupiterApi.swapPost({
					swapRequest: {
						quoteResponse,
						userPublicKey: wallet.publicKey.toString(),
						wrapAndUnwrapSol: true,
						dynamicComputeUnitLimit: true,
					},
				});

				const swapTransactionBuf = Buffer.from(
					swapResponse.swapTransaction,
					"base64",
				);
				const transaction =
					VersionedTransaction.deserialize(swapTransactionBuf);

				// Sign the transaction
				transaction.sign([wallet]);

				// Send the transaction
				const rawTransaction = transaction.serialize();
				const txid = await connection.sendRawTransaction(rawTransaction, {
					skipPreflight: true,
					maxRetries: 2,
				});

				logger.info(`Transaction sent: ${txid}`);

				// Confirm the transaction with latest blockhash
				const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
				await connection.confirmTransaction({
					blockhash,
					lastValidBlockHeight,
					signature: txid,
				});

				// Calculate output amount and price
				const tokenDecimals = tokenSymbol === "SOL" ? 9 : 6; // Placeholder decimals
				const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, tokenDecimals);
				const actualPrice = tradeAmountUSD / outputAmount;

				// Update the trade record
				const updatedTrade = await prisma.trade.update({
					where: { id: trade.id },
					data: {
						tokenAmount: outputAmount,
						priceUsd: actualPrice,
						transactionHash: txid,
						status: "completed",
					},
				});

				logger.info(
					`Real trade executed: ${updatedTrade.id}, txid: ${txid}, tokens: ${outputAmount}, price: $${actualPrice.toFixed(6)}`,
				);

				return updatedTrade;
			} catch (error) {
				logger.error("Error executing real trade:", error);

				// Update the trade record with error
				try {
					await prisma.trade.updateMany({
						where: { 
							analysisId: analysisResult.id,
							status: "pending"
						},
						data: {
							status: "failed",
							errorMessage:
								error instanceof Error ? error.message : "Unknown error",
						},
					});
				} catch (dbError) {
					logger.error("Error updating trade record:", dbError);
				}

				return null;
			}
		}
	} catch (error) {
		logger.error("Error in executeTrade:", error);
		return null;
	} finally {
		timer();
	}
}

// Process analysis results
async function processAnalysisResult(
	analysisResult: AnalysisResult,
): Promise<void> {
	const timer = logger.startTimer("process_analysis");

	try {
		logger.info(`Processing analysis result for post ${analysisResult.postId}`);

		// Execute trade
		const tradeResult = await executeTrade(analysisResult);

		// Log trade result if trade was executed
		if (tradeResult) {
			logger.info(`Trade execution completed: ${tradeResult.id}, Status: ${tradeResult.status}`);
			
			// Create a notification for successful trade
			await prisma.notification.create({
				data: {
					type: "trade",
					title: "Trade Executed",
					message: `Successfully ${tradeResult.isPaperTrade ? 'simulated' : 'executed'} trade for ${tradeResult.tokenSymbol}: ${tradeResult.tokenAmount} tokens at $${tradeResult.priceUsd}`,
					data: { tradeId: tradeResult.id, tokenSymbol: tradeResult.tokenSymbol },
				},
			});
		}
	} catch (error) {
		logger.error("Error processing analysis result:", error);
	} finally {
		timer();
	}
}

// Setup analysis result processor
function setupAnalysisProcessor() {
	try {
		// Poll for new analysis results every 5 seconds
		setInterval(async () => {
			try {
				// Get unprocessed analysis results (those without trades)
				const unprocessedAnalyses = await prisma.analysisResult.findMany({
					where: {
						trades: {
							none: {},
						},
						processedAt: {
							gte: new Date(Date.now() - 5 * 60 * 1000), // Only process results from last 5 minutes
						},
					},
					orderBy: {
						processedAt: 'desc',
					},
					take: 5, // Process max 5 at a time
				});

				for (const analysis of unprocessedAnalyses) {
					logger.info(`Processing analysis result for post ${analysis.postId}, decision: ${analysis.decision}, confidence: ${analysis.confidence}`);
					await processAnalysisResult(analysis);
					
					// Small delay between processing to avoid overwhelming the system
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			} catch (error) {
				logger.error("Error in analysis processor:", error);
			}
		}, 5000);

		logger.info("Analysis processor initialized - polling every 5 seconds");
	} catch (error) {
		logger.error("Error setting up analysis processor:", error);
	}
}

// Start the server
app.listen(PORT, () => {
	logger.info(`Trading Orchestrator Service running on port ${PORT}`);
	logger.info(`Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
	logger.info(`Maximum position size: ${MAX_POSITION_SIZE * 100}%`);
	logger.info(`Maximum portfolio exposure: ${MAX_PORTFOLIO_EXPOSURE * 100}%`);
	logger.info(`Trading mode: ${PAPER_TRADING_MODE ? "PAPER" : "REAL"}`);

	// Initialize the analysis processor
	setupAnalysisProcessor();
});

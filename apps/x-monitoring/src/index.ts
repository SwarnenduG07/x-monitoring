import { prisma } from "@believe-x/database";
import { createLogger, type XPost } from "@believe-x/shared";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

const PORT = process.env.PORT || 3000;
const MONITORING_INTERVAL = parseInt(
	process.env.MONITORING_INTERVAL || "60000",
	10,
);
const TRADE_BOT_URL = process.env.TRADE_BOT_URL || "http://localhost:3002";
const AI_ANALYSIS_URL = process.env.AI_ANALYSIS_URL || "http://localhost:8000";
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || "http://localhost:3001";


const API_KEY = process.env.TWITTER_API_KEY as string;
const API_KEY_SECRET = process.env.TWITTER_API_KEY_SECRET as string;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN as string;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET as string;

const app = express();
const logger = createLogger("x-monitoring");

const twitterClient = new TwitterApi({
	appKey: API_KEY,
	appSecret: API_KEY_SECRET,
	accessToken: ACCESS_TOKEN,
	accessSecret: ACCESS_TOKEN_SECRET,
});

const latestPostIds = new Map<string, string>();

const rateLimitedAccounts = new Map<string, number>();

let accountIndex = 0;
const MAX_ACCOUNTS_PER_CYCLE = 2;

app.use(express.json());

app.get("/health", async (req, res) => {
	try {
		await prisma.$queryRaw`SELECT 1`;
		res.status(200).json({ status: "ok" });
	} catch (error) {
		logger.error("Health check failed", error);
		res
			.status(500)
			.json({ status: "error", message: "Data1`  ₹ase connection failed" });
	}
});

async function getUserFromTwitter(username: string) {
	try {
		const user = await twitterClient.v2.userByUsername(username);
		if (!user.data) {
			throw new Error(`User not found: ${username}`);
		}
		return user.data;
	} catch (error: any) {
		logger.error(`Error fetching user from Twitter API: ${error.message}`);
		throw error;
	}
}

//  Function to get tweets from Twitter API v2 with improved error handling
async function getTweetsFromTwitter(userId: string, count: number = 5) {
	if (!userId || userId.trim() === "") {
		logger.error("Invalid user ID provided to getTweetsFromTwitter");
		return [];
	}

	try {
		logger.debug(`Fetching tweets for user ID: ${userId}, count: ${count}`);

		const tweets = await twitterClient.v2.userTimeline(userId, {
			max_results: count,
			"tweet.fields": ["created_at", "text", "id"],
			expansions: ["author_id"],
		});

		return tweets.data.data || [];
	} catch (error: any) {
		if (error.message) {
			if (error.message.includes("429")) {
				logger.warn(
					`Twitter API rate limit reached for user ${userId}. Will retry later.`,
				);
				return [];
			}

			// Invalid request (400)
			if (error.message.includes("400")) {
				logger.error(
					`Invalid request to Twitter API for user ${userId}. Check user ID and parameters.`,
				);

				if (error.data && error.data.errors) {
					logger.error(
						`Twitter API errors: ${JSON.stringify(error.data.errors)}`,
					);
				}

				return [];
			}

			// User not found or unauthorized (401, 404)
			if (error.message.includes("401") || error.message.includes("404")) {
				logger.error(
					`User ${userId} not found or unauthorized access. Check credentials and user ID.`,
				);
				return [];
			}
		}

		logger.error(`Error fetching tweets from Twitter API: ${error.message}`);
		logger.debug(`Full error: ${JSON.stringify(error)}`);
		return []; // Return empty array instead of throwing to prevent continuous errors
	}
}

app.get("/api/accounts", async (req, res) => {
	try {
		const accounts = await prisma.monitoredAccount.findMany();
		res.json(accounts);
	} catch (error) {
		logger.error("Error fetching accounts:", error);
		res.status(500).json({ error: "Failed to fetch accounts" });
	}
});

app.post("/api/accounts", async (req, res) => {
	const { username } = req.body;

	if (!username) {
		return res.status(400).json({ error: "Username is required" });
	}

	try {
		const cleanUsername = username.startsWith("@")
			? username.substring(1)
			: username;

		const existingAccount = await prisma.monitoredAccount.findFirst({
			where: {
				xUsername: cleanUsername,
			},
		});

		if (existingAccount) {
			return res.status(200).json(existingAccount);
		}

		// Get user info from Twitter API
		try {
			const userData = await getUserFromTwitter(cleanUsername);

			if (!userData || !userData.id) {
				return res.status(404).json({
					error: "User not found on Twitter",
					details: `Could not find user with username: ${cleanUsername}`,
				});
			}

			logger.info(`Found Twitter user: ${cleanUsername}, ID: ${userData.id}`);

			const account = await prisma.monitoredAccount.create({
				data: {
					xAccountId: userData.id,
					xUsername: userData.username || cleanUsername,
					displayName: userData.name || cleanUsername,
				},
			});

			logger.info(
				`Successfully created account for ${cleanUsername} with ID ${account.xAccountId}`,
			);
			res.status(201).json(account);
		} catch (apiError: any) {
			logger.error(`Error fetching Twitter user ${cleanUsername}:`, apiError);
			res.status(500).json({
				error: "Failed to fetch Twitter user",
				details: apiError.message,
			});
		}
	} catch (error) {
		logger.error("Error adding account:", error);
		res.status(500).json({ error: "Failed to add account" });
	}
});

app.get("/api/active-accounts", async (req, res) => {
	try {
		const accountsWithSubscriptions = await prisma.monitoredAccount.findMany({
			where: {
				userSubscriptions: {
					some: {
						active: true,
					},
				},
			},
		});

		res.json(accountsWithSubscriptions);
	} catch (error) {
		logger.error("Error fetching active accounts:", error);
		res.status(500).json({ error: "Failed to fetch active accounts" });
	}
});

app.get("/api/subscriptions", async (req, res) => {
	try {
		const { tokenId, accountId } = req.query;

		const whereClause: any = {
			active: true,
		};

		if (tokenId) {
			whereClause.tokenId = parseInt(tokenId as string);
		}

		if (accountId) {
			whereClause.accountId = parseInt(accountId as string);
		}

		const subscriptions = await prisma.userSubscription.findMany({
			where: whereClause,
			include: {
				user: true,
				account: true,
				token: true,
			},
		});

		res.json(subscriptions);
	} catch (error) {
		logger.error("Error fetching subscriptions:", error);
		res.status(500).json({ error: "Failed to fetch subscriptions" });
	}
});

async function monitorAccounts() {
	try {
		logger.info("Starting monitoring cycle");

		// Get all accounts with active subscriptions
		const allAccounts = await prisma.monitoredAccount.findMany({
			where: {
				userSubscriptions: {
					some: {
						active: true,
					},
				},
			},
			include: {
				userSubscriptions: {
					where: {
						active: true,
					},
					include: {
						token: true,
						user: true,
					},
				},
			},
		});

		const startIndex = accountIndex;
		const endIndex = Math.min(
			startIndex + MAX_ACCOUNTS_PER_CYCLE,
			allAccounts.length,
		);
		const accounts = allAccounts.slice(startIndex, endIndex);

		accountIndex = endIndex >= allAccounts.length ? 0 : endIndex;

		logger.info(
			`Monitoring ${accounts.length} of ${allAccounts.length} accounts with active subscriptions (batch ${startIndex}-${endIndex - 1})`,
		);

		const now = Date.now();

		for (const account of accounts) {
			if (rateLimitedAccounts.has(account.xAccountId)) {
				const nextAllowedTime = rateLimitedAccounts.get(account.xAccountId)!;
				if (now < nextAllowedTime) {
					logger.info(
						`Skipping rate-limited account @${account.xUsername} until ${new Date(nextAllowedTime).toISOString()}`,
					);
					continue;
				} else {
					rateLimitedAccounts.delete(account.xAccountId);
				}
			}

			const timer = logger.startTimer(`fetch_tweets_${account.xUsername}`);

			try {
				const tweets = await getTweetsFromTwitter(account.xAccountId, 5); 

				if (tweets.length === 0) {
					const backoffTime = rateLimitedAccounts.has(account.xAccountId)
						? Math.min(
								(rateLimitedAccounts.get(account.xAccountId)! - now) * 2,
								3600000,
							) 
						: 300000; 

					rateLimitedAccounts.set(account.xAccountId, now + backoffTime);
					logger.warn(
						`No tweets returned for @${account.xUsername}, implementing backoff of ${backoffTime / 60000} minutes`,
					);
					continue;
				}

				logger.info(
					`Fetched ${tweets.length} tweets for @${account.xUsername} from Twitter API`,
				);

				if (tweets.length > 0) {
				
					tweets.sort((a: any, b: any) => {
						const dateA = new Date(a.created_at);
						const dateB = new Date(b.created_at);
						return dateB.getTime() - dateA.getTime();
					});

					const latestTweetId = latestPostIds.get(account.xUsername);
					const newTweets = latestTweetId
						? tweets.filter((tweet: any) => tweet.id > latestTweetId)
						: tweets.slice(0, 3); 

					if (tweets.length > 0) {
						latestPostIds.set(account.xUsername, tweets[0].id);
					}

					if (newTweets.length > 0) {
						logger.info(
							`Found ${newTweets.length} new tweets for @${account.xUsername}`,
						);
					}

					for (const tweet of newTweets) {
						const post: XPost = {
							id: tweet.id,
							text: tweet.text,
							authorId: account.xAccountId,
							authorUsername: account.xUsername,
							authorDisplayName: account.displayName || account.xUsername,
							createdAt: tweet.created_at || new Date().toISOString(),
							url: `https://x.com/${account.xUsername}/status/${tweet.id}`,
						};

						let savedPost;
						try {
							const existingPost = await prisma.post.findUnique({
								where: {
									postId: post.id,
								},
							});

							if (existingPost) {
								logger.info(`Post ${post.id} already exists in database, skipping creation`);
								savedPost = existingPost;
							} else {
								savedPost = await prisma.post.create({
									data: {
										postId: post.id,
										accountId: account.id,
										content: post.text,
										postUrl: post.url,
										postedAt: new Date(post.createdAt),
									},
								});
								logger.info(`Created new post record for ID: ${post.id}`);
							}
						} catch (error) {
							logger.error(`Error saving post ${post.id}: ${error}`);
							continue; 
						}

						
						const tokenSubscriptions = new Map<
							number,
							{ token: any; users: any[] }
						>();

						for (const subscription of account.userSubscriptions) {
							if (!tokenSubscriptions.has(subscription.tokenId)) {
								tokenSubscriptions.set(subscription.tokenId, {
									token: subscription.token,
									users: [],
								});
							}
							tokenSubscriptions
								.get(subscription.tokenId)!
								.users.push(subscription.user);
						}

						
						for (const [tokenId, data] of tokenSubscriptions.entries()) {
							const { token, users } = data;

							if (!token || typeof token.symbol !== "string") {
								logger.warn(
									`Skipping token without valid symbol: ${JSON.stringify(token)}`,
								);
								continue;
							}

							try {
								
								const tokenSymbol = token.symbol;
								const aiAnalysisResponse = await axios.post(
									`${AI_ANALYSIS_URL}/api/analyze`,
									{
										postId: savedPost.id,
										postText: post.text,
										authorUsername: post.authorUsername,
										authorDisplayName: post.authorDisplayName,
										postUrl: post.url,
										timestamp: post.createdAt,
										tokenSymbols: [tokenSymbol],
									},
									{
										timeout: 30000, // 30 second timeout
									}
								);

								logger.info(
									`AI analysis completed for tweet from @${post.authorUsername} about token ${tokenSymbol}`,
								);

								// Check if analysis indicates a bullish/optimistic post
								const analysis = aiAnalysisResponse.data;
								if (analysis && analysis.decision === "buy") {
									logger.info(
										`Bullish signal detected for ${tokenSymbol} from tweet by @${post.authorUsername} (confidence: ${analysis.confidence})`,
									);

									// Send to trade-bot with token information and AI analysis
									await axios.post(`${TRADE_BOT_URL}/api/webhook/new-post`, {
										postId: savedPost.id,
										postText: post.text,
										authorUsername: post.authorUsername,
										authorDisplayName: post.authorDisplayName,
										postUrl: post.url,
										timestamp: post.createdAt,
										tokenInfo: {
											id: token.id,
											address: token.address,
											symbol: tokenSymbol,
										},
										subscribers: users.map((u) => u.telegramId),
										analysis: analysis,
									});

									logger.info(
										`New bullish post notification sent to trade-bot for @${post.authorUsername} with token ${tokenSymbol}`,
									);
								} else {
									logger.info(
										`No bullish signal detected for ${tokenSymbol} from tweet by @${post.authorUsername} (decision: ${analysis?.decision || 'unknown'})`,
									);
								}
							} catch (error) {
								logger.error(`Error processing post for token ${token.symbol}:`, error);
							}
						}

						logger.info(
							`New post detected from ${post.authorUsername}: ${post.text.substring(0, 50)}...`,
						);
					}
				}
			} catch (error: any) {
				// If we hit a rate limit, implement exponential backoff
				if (error.message && error.message.includes("429")) {
					const backoffTime = rateLimitedAccounts.has(account.xAccountId)
						? Math.min(
								(rateLimitedAccounts.get(account.xAccountId)! - now) * 2,
								3600000,
							) 
						: 300000; 

					rateLimitedAccounts.set(account.xAccountId, now + backoffTime);
					logger.warn(
						`Rate limit hit for @${account.xUsername}, implementing backoff of ${backoffTime / 60000} minutes`,
					);
				} else {
					logger.error(`Error monitoring account ${account.xUsername}:`, error);
				}
			} finally {
				timer();
			}
		}
	} catch (error) {
		logger.error("Error in monitoring cycle:", error);
	} finally {
		setTimeout(monitorAccounts, MONITORING_INTERVAL);
	}
}

async function verifyTwitterUserId(userId: string): Promise<boolean> {
	if (!userId || userId.trim() === "" || userId.includes("placeholder_")) {
		logger.warn(`Invalid Twitter user ID format: ${userId}`);
		return false;
	}

	try {
		const user = await twitterClient.v2.user(userId);
		return !!user.data;
	} catch (error) {
		logger.error(`Failed to verify Twitter user ID ${userId}`);
		return false;
	}
}

app.post("/api/accounts/:id/refresh", async (req, res) => {
	try {
		const id = parseInt(req.params.id);

		if (isNaN(id)) {
			return res.status(400).json({ error: "Invalid account ID" });
		}

		const account = await prisma.monitoredAccount.findUnique({
			where: { id },
		});

		if (!account) {
			return res.status(404).json({ error: "Account not found" });
		}

		try {
			const userData = await getUserFromTwitter(account.xUsername);

			if (!userData || !userData.id) {
				return res.status(404).json({
					error: "User not found on Twitter",
					details: `Could not find user with username: ${account.xUsername}`,
				});
			}

			const updatedAccount = await prisma.monitoredAccount.update({
				where: { id },
				data: {
					xAccountId: userData.id,
					xUsername: userData.username || account.xUsername,
					displayName: userData.name || account.displayName,
				},
			});

			logger.info(
				`Successfully refreshed account data for ${account.xUsername} with ID ${updatedAccount.xAccountId}`,
			);
			res.status(200).json(updatedAccount);
		} catch (apiError: any) {
			logger.error(
				`Error refreshing Twitter user ${account.xUsername}:`,
				apiError,
			);
			res.status(500).json({
				error: "Failed to refresh Twitter user",
				details: apiError.message,
			});
		}
	} catch (error) {
		logger.error("Error refreshing account:", error);
		res.status(500).json({ error: "Failed to refresh account" });
	}
});

// Function to check and fix invalid accounts
async function checkAndFixAccounts() {
	try {
		logger.info("Checking for invalid accounts...");

		const accounts = await prisma.monitoredAccount.findMany();

		for (const account of accounts) {
			try {
				const isValid = await verifyTwitterUserId(account.xAccountId);

				if (!isValid) {
					logger.warn(
						`Invalid Twitter user ID found for ${account.xUsername}: ${account.xAccountId}`,
					);

					// Try to refresh the account data
					try {
						const userData = await getUserFromTwitter(account.xUsername);

						if (userData && userData.id) {
							// Update with correct ID
							await prisma.monitoredAccount.update({
								where: { id: account.id },
								data: {
									xAccountId: userData.id,
									xUsername: userData.username || account.xUsername,
									displayName: userData.name || account.displayName,
								},
							});

							logger.info(
								`Fixed account data for ${account.xUsername}, updated ID: ${userData.id}`,
							);
						}
					} catch (refreshError) {
						logger.error(
							`Could not refresh data for ${account.xUsername}:`,
							refreshError,
						);
					}
				}
			} catch (verifyError) {
				logger.error(
					`Error verifying account ${account.xUsername}:`,
					verifyError,
				);
			}
		}

		logger.info("Account verification complete");
	} catch (error) {
		logger.error("Error checking accounts:", error);
	}
}

async function cleanupInvalidAccounts() {
	try {
		logger.info("Starting cleanup of invalid accounts...");

		const accounts = await prisma.monitoredAccount.findMany();
		let fixedCount = 0;

		for (const account of accounts) {
			if (
				account.xAccountId.includes("placeholder_") ||
				!account.xAccountId.match(/^[0-9]+$/) || 
				account.xAccountId.length < 5
			) {
				
				logger.warn(
					`Found invalid Twitter ID format: ${account.xAccountId} for user ${account.xUsername}`,
				);

				try {
					
					const userData = await getUserFromTwitter(account.xUsername);

					if (userData && userData.id) {
						
						await prisma.monitoredAccount.update({
							where: { id: account.id },
							data: {
								xAccountId: userData.id,
								xUsername: userData.username || account.xUsername,
								displayName: userData.name || account.displayName,
							},
						});

						logger.info(
							`Fixed account data for ${account.xUsername}, updated ID from ${account.xAccountId} to ${userData.id}`,
						);
						fixedCount++;
					} else {
						logger.error(
							`Could not find Twitter user for ${account.xUsername}`,
						);
					}
				} catch (error) {
					logger.error(`Error fixing account ${account.xUsername}:`, error);
				}
			}
		}

		logger.info(`Account cleanup complete. Fixed ${fixedCount} accounts.`);
	} catch (error) {
		logger.error("Error during account cleanup:", error);
	}
}

app.post("/api/accounts/cleanup", async (req, res) => {
	try {
		logger.info("Manual account cleanup triggered");
		await cleanupInvalidAccounts();
		res.status(200).json({ message: "Account cleanup completed" });
	} catch (error) {
		logger.error("Error during manual account cleanup:", error);
		res.status(500).json({ error: "Failed to clean up accounts" });
	}
});

app.listen(PORT, () => {
	logger.info(`X Monitoring Service running on port ${PORT}`);
	logger.info(`Monitoring interval: ${MONITORING_INTERVAL}ms`);

	
	cleanupInvalidAccounts().then(() => {
		monitorAccounts();
	});
});

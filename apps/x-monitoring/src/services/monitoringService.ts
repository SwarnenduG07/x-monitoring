import { prisma } from "@believe-x/database";
import { createLogger, type XPost } from "@believe-x/shared";
import axios from "axios";
import { getTweetsFromTwitter } from "../utils/twitter.js";

const logger = createLogger("monitoring-service");

const MONITORING_INTERVAL = parseInt(
	process.env.MONITORING_INTERVAL || "60000",
	10,
);
const TRADE_BOT_URL = process.env.TRADE_BOT_URL || "http://localhost:3002";
const AI_ANALYSIS_URL = process.env.AI_ANALYSIS_URL || "http://localhost:8000";

export const latestPostIds = new Map<string, string>();
export const rateLimitedAccounts = new Map<string, number>();

let accountIndex = 0;
const MAX_ACCOUNTS_PER_CYCLE = 2;

export async function monitorAccounts() {
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

export function startMonitoring() {
	logger.info(`Starting monitoring with interval: ${MONITORING_INTERVAL}ms`);
	monitorAccounts();
} 
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
						: tweets.slice(0, 1); // Only process the latest tweet when first monitoring

					if (tweets.length > 0) {
						latestPostIds.set(account.xUsername, tweets[0].id);
					}

					if (newTweets.length > 0) {
						logger.info(
							`Found ${newTweets.length} new tweets for @${account.xUsername}`,
						);
						
						const savedPosts = [];
						const postsNeedingAnalysis = [];
						
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

							try {
								// Check if post exists
								let existingPost = await prisma.post.findUnique({
									where: { postId: post.id },
									include: {
										analyses: {
											take: 1,
										},
									},
								});

								let savedPost;
								let needsAnalysis = false;
								
								if (existingPost) {
									logger.info(`Post ${post.id} already exists in database`);
									savedPost = existingPost;
									
									// Only analyze if no previous analysis exists
									if (existingPost.analyses.length === 0) {
										logger.info(`Post ${post.id} has no analysis yet, will analyze`);
										needsAnalysis = true;
									} else {
										logger.info(`Post ${post.id} already has analysis, skipping`);
									}
								} else {
									// New post, create and mark for analysis
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
									needsAnalysis = true;
								}
								
								if (needsAnalysis) {
									postsNeedingAnalysis.push({ post, savedPost });
								}
								
								savedPosts.push({ post, savedPost });
							} catch (error) {
								logger.error(`Error saving post ${post.id}: ${error}`);
							}
						}

						// Only proceed with analysis if we have posts that need it
						if (postsNeedingAnalysis.length > 0) {
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

									const batchAnalysisRequest = {
										posts: postsNeedingAnalysis.map(({ post, savedPost }) => ({
											postId: savedPost.id,
											postText: post.text,
											authorUsername: post.authorUsername,
											authorDisplayName: post.authorDisplayName,
											postUrl: post.url,
											timestamp: post.createdAt,
											tokenSymbols: [tokenSymbol],
										})),
										tokenSymbols: [tokenSymbol],
									};

									logger.info(
										`Sending batch analysis for ${postsNeedingAnalysis.length} tweets about token ${tokenSymbol}`,
									);

									const aiAnalysisResponse = await axios.post(
										`${AI_ANALYSIS_URL}/api/analyze-batch`,
										batchAnalysisRequest,
										{
											timeout: 60000,
										},
									);

									logger.info(
										`Batch AI analysis completed for ${postsNeedingAnalysis.length} tweets from @${account.xUsername} about token ${tokenSymbol}`,
									);

									const analysis = aiAnalysisResponse.data;
									if (analysis && analysis.decision === "buy") {
										logger.info(
											`Bullish signal detected for ${tokenSymbol} from ${postsNeedingAnalysis.length} tweets by @${account.xUsername} (confidence: ${analysis.confidence})`,
										);

										for (const { post, savedPost } of postsNeedingAnalysis) {
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
										}

										logger.info(
											`Bullish signal notifications sent to trade-bot for ${postsNeedingAnalysis.length} posts about ${tokenSymbol}`,
										);
									} else {
										logger.info(
											`No bullish signal detected for ${tokenSymbol} from ${postsNeedingAnalysis.length} tweets by @${account.xUsername} (decision: ${analysis?.decision || "unknown"})`,
										);
									}
								} catch (error: any) {
									logger.error(`Error processing analysis: ${error.message}`);
								}
							}
						} else {
							logger.info(`No new tweets need analysis for @${account.xUsername}`);
						}
					} else {
						logger.info(`No new tweets found for @${account.xUsername}`);
					}
				}
			} catch (error: any) {
				logger.error(`Error monitoring account @${account.xUsername}: ${error.message}`);
			}
		}
	} catch (error: any) {
		logger.error(`Error in monitoring cycle: ${error.message}`);
	}
}

export function startMonitoring() {
	logger.info(`Starting monitoring with interval: ${MONITORING_INTERVAL}ms`);
	monitorAccounts();
	setInterval(monitorAccounts, MONITORING_INTERVAL);
}

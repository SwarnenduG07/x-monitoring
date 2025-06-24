import { Router } from "express";
import { bot, logger } from "../../index";
import axios from "axios";
import { prisma } from "@believe-x/database";

const router = Router();

const TRADING_ORCHESTRATOR_URL = process.env.TRADING_ORCHESTRATOR_URL || "http://localhost:3003";

router.post("/webhook/new-post", async (req, res) => {
	try {
		const {
			postId,
			postText,
			authorUsername,
			authorDisplayName,
			postUrl,
			timestamp,
			tokenInfo,
			subscribers,
			analysis,
		} = req.body;

		logger.info(
			`Received new post from @${authorUsername}: ${postText.substring(0, 50)}...`,
		);

		if (tokenInfo && analysis) {
			try {
				const decisionEmoji =
					analysis.decision === "buy"
						? "🟢 BUY"
						: analysis.decision === "sell"
							? "🔴 SELL"
							: "⚪ HOLD";

				let tokenSentiment = 0;
				let tokenSentimentEmoji = "➖";

				if (analysis.marketConditions?.relatedTokens) {
					const tokenData = analysis.marketConditions.relatedTokens.find(
						(t: any) => t.symbol === tokenInfo.symbol,
					);

					if (tokenData) {
						tokenSentiment = tokenData.sentiment;
						tokenSentimentEmoji =
							tokenSentiment > 0.3 ? "📈" : tokenSentiment < -0.3 ? "📉" : "➖";
					}
				}

				const positiveSignals = analysis.reasons.positiveSignals
					.map((s: string) => `✅ ${s}`)
					.join("\n");

				const negativeSignals = analysis.reasons.negativeSignals
					.map((s: string) => `❌ ${s}`)
					.join("\n");

				const message = `
<b>${tokenInfo.symbol} Alert!</b>

@${authorUsername} tweeted:
"${postText.substring(0, 100)}${postText.length > 100 ? "..." : ""}"

<b>AI Analysis:</b> ${decisionEmoji} (Confidence: ${Math.round(analysis.confidence * 100)}%)
<b>Token Sentiment:</b> ${tokenSentimentEmoji} ${tokenSentiment.toFixed(2)}

${positiveSignals ? `<b>Positive Signals:</b>\n${positiveSignals}\n\n` : ""}
${negativeSignals ? `<b>Concerns:</b>\n${negativeSignals}\n\n` : ""}

<b>Token:</b> ${tokenInfo.address.substring(0, 8)}...${tokenInfo.address.substring(tokenInfo.address.length - 6)}

<a href="${postUrl}">View on X</a>
`;

				if (subscribers && subscribers.length > 0) {
					for (const telegramId of subscribers) {
						try {
							await bot.telegram.sendMessage(telegramId, message, {
								parse_mode: "HTML",
							});

							logger.info(
								`Analysis sent to user ${telegramId} for ${tokenInfo.symbol}`,
							);
						} catch (error) {
							logger.error(
								`Failed to send message to user ${telegramId}:`,
								error,
							);
						}
					}
				}

				if (analysis.decision === "buy" && analysis.confidence >= 0.8) {
					logger.info(
						`High confidence buy signal for ${tokenInfo.symbol}, sending to trading orchestrator`,
					);

					try {
						const tradeRequest = {
							tokenAddress: tokenInfo.address,
							tokenSymbol: tokenInfo.symbol,
							action: "buy",
							confidence: analysis.confidence,
							analysis: analysis,
							postData: {
								postId,
								postText,
								authorUsername,
								postUrl,
								timestamp,
							},
						};

						const tradeResponse = await axios.post(
							`${TRADING_ORCHESTRATOR_URL}/api/trade`,
							tradeRequest,
							{ timeout: 10000 }
						);

						logger.info(
							`Trade request sent to orchestrator for ${tokenInfo.symbol}: ${tradeResponse.status}`,
						);
					} catch (tradeError) {
						logger.error(
							`Failed to send trade request to orchestrator for ${tokenInfo.symbol}:`,
							tradeError,
						);
					}
				}

				res.status(200).json({ success: true, analysis });
				return;
			} catch (error) {
				logger.error(`Error processing post for ${tokenInfo.symbol}:`, error);
				res.status(500).json({ error: "Error processing post" });
				return;
			}
		}

		try {
			const post = await prisma.post.findUnique({
				where: { id: postId },
				include: { account: true },
			});

			if (!post) {
				logger.error(`Post not found: ${postId}`);
				return res.status(404).json({ error: "Post not found" });
			}

			const subscriptions = await prisma.userSubscription.findMany({
				where: {
					accountId: post.accountId,
					active: true,
				},
				include: {
					user: true,
					token: true,
				},
			});

			if (subscriptions.length === 0) {
				logger.info(`No active subscriptions for @${authorUsername}`);
				return res.status(200).json({ message: "No active subscriptions" });
			}

			logger.info(
				`Legacy path: Found ${subscriptions.length} subscriptions for @${authorUsername}`,
			);

			res.status(200).json({ success: true, message: "Legacy path processed" });
		} catch (dbError) {
			logger.error("Database error:", dbError);
			res.status(500).json({ error: "Database error" });
		}
	} catch (error) {
		logger.error("Error processing new post webhook:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

export const postRouter = router;
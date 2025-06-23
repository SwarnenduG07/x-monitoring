import dotenv from "dotenv";
dotenv.config();
import { createLogger } from "@believe-x/shared";
import { TwitterApi } from "twitter-api-v2";

const logger = createLogger("twitter-utils");

const API_KEY = process.env.TWITTER_API_KEY as string;
const API_KEY_SECRET = process.env.TWITTER_API_KEY_SECRET as string;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN as string;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET as string;

export const twitterClient = new TwitterApi({
	appKey: API_KEY,
	appSecret: API_KEY_SECRET,
	accessToken: ACCESS_TOKEN,
	accessSecret: ACCESS_TOKEN_SECRET,
});

export async function getUserFromTwitter(username: string) {
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

export async function getTweetsFromTwitter(userId: string, count: number = 5) {
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

export async function verifyTwitterUserId(userId: string): Promise<boolean> {
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
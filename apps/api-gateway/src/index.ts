import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

dotenv.config();

const PORT = process.env.PORT || 3001;
const X_MONITORING_URL =
	process.env.X_MONITORING_URL || "http://localhost:3000";
const AI_ANALYSIS_URL = process.env.AI_ANALYSIS_URL || "http://localhost:8000";
const TRADE_BOT_URL = process.env.TRADE_BOT_URL || "http://localhost:3002";
const TRADING_ORCHESTRATOR_URL =
	process.env.TRADING_ORCHESTRATOR_URL || "http://localhost:3003";

const app = express();
const logger = createLogger("api-gateway");

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
	message: "Too many requests from this IP, please try again after 15 minutes",
});

app.use(limiter);

app.get("/health", async (req, res) => {
	try {
		await prisma.$queryRaw`SELECT 1`;
		res.status(200).json({ status: "ok" });
	} catch (error) {
		logger.error("Health check failed", error);
		res
			.status(500)
			.json({ status: "error", message: "Database connection failed" });
	}
});

app.get("/api/posts", async (req, res) => {
	try {
		const posts = await prisma.post.findMany({
			orderBy: {
				postedAt: "desc",
			},
			include: {
				account: true,
			},
			take: 50,
		});

		res.json(posts);
	} catch (error) {
		logger.error("Error fetching posts:", error);
		res.status(500).json({ error: "Failed to fetch posts" });
	}
});

app.get("/api/posts/:id", async (req, res) => {
	try {
		const postId = parseInt(req.params.id);

		if (isNaN(postId)) {
			return res.status(400).json({ error: "Invalid post ID" });
		}

		const post = await prisma.post.findUnique({
			where: {
				id: postId,
			},
			include: {
				account: true,
				analyses: true,
			},
		});

		if (!post) {
			return res.status(404).json({ error: "Post not found" });
		}

		res.json(post);
	} catch (error) {
		logger.error("Error fetching post:", error);
		res.status(500).json({ error: "Failed to fetch post" });
	}
});

app.get("/api/accounts", async (req, res) => {
	try {
		const accounts = await prisma.monitoredAccount.findMany({
			orderBy: {
				createdAt: "desc",
			},
		});

		res.json(accounts);
	} catch (error) {
		logger.error("Error fetching accounts:", error);
		res.status(500).json({ error: "Failed to fetch accounts" });
	}
});

app.post("/api/accounts", async (req, res) => {
	try {
		const { username } = req.body;

		if (!username) {
			return res.status(400).json({ error: "Username is required" });
		}

		try {
			const response = await axios.post(`${X_MONITORING_URL}/api/accounts`, {
				username,
			});
			res.status(response.status).json(response.data);
		} catch (error) {
			logger.error("Error forwarding request to X monitoring service:", error);
			res.status(500).json({ error: "Failed to add account" });
		}
	} catch (error) {
		logger.error("Error creating account:", error);
		res.status(500).json({ error: "Failed to create account" });
	}
});

app.get("/api/telegram-users", async (req, res) => {
	try {
		const users = await prisma.telegramUser.findMany({
			orderBy: {
				createdAt: "desc",
			},
		});

		res.json(users);
	} catch (error) {
		logger.error("Error fetching telegram users:", error);
		res.status(500).json({ error: "Failed to fetch telegram users" });
	}
});

app.get("/api/user-subscriptions", async (req, res) => {
	try {
		const { userId, tokenSymbol, accountId, active } = req.query;

		const whereClause: any = {};

		if (userId) {
			whereClause.userId = parseInt(userId as string);
		}

		if (tokenSymbol) {
			whereClause.tokenSymbol = tokenSymbol as string;
		}

		if (accountId) {
			whereClause.accountId = parseInt(accountId as string);
		}

		if (active !== undefined) {
			whereClause.active = active === "true";
		}

		const subscriptions = await prisma.userSubscription.findMany({
			where: whereClause,
			include: {
				user: true,
				account: true,
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		res.json(subscriptions);
	} catch (error) {
		logger.error("Error fetching user subscriptions:", error);
		res.status(500).json({ error: "Failed to fetch user subscriptions" });
	}
});

app.post("/api/user-subscriptions", async (req, res) => {
	try {
		const { telegramId, xUsername, tokenId } = req.body;

		if (!telegramId || !xUsername || !tokenId) {
			return res
				.status(400)
				.json({ error: "Telegram ID, X username, and token ID are required" });
		}

		// Find or create telegram user
		const user = await prisma.telegramUser.findUnique({
			where: { telegramId },
		});

		if (!user) {
			return res.status(404).json({ error: "Telegram user not found" });
		}

		// Find or create X account
		try {
			// First, check if account exists
			let account = await prisma.monitoredAccount.findFirst({
				where: { xUsername },
			});

			// If account doesn't exist, create it
			if (!account) {
				// Forward the request to the X monitoring service
				const response = await axios.post(`${X_MONITORING_URL}/api/accounts`, {
					username: xUsername,
				});
				account = response.data;
			}

			// Check if subscription already exists
			const existingSubscription = await prisma.userSubscription.findFirst({
				where: {
					userId: user.id,
					accountId: account!.id,
					tokenId: tokenId,
				},
			});

			if (existingSubscription) {
				// If subscription exists but is inactive, activate it
				if (!existingSubscription.active) {
					const updatedSubscription = await prisma.userSubscription.update({
						where: { id: existingSubscription.id },
						data: { active: true },
					});

					return res.status(200).json(updatedSubscription);
				}

				return res.status(200).json(existingSubscription);
			}

			// Create new subscription
			const subscription = await prisma.userSubscription.create({
				data: {
					userId: user.id,
					accountId: account!.id,
					tokenId: tokenId,
				},
			});

			res.status(201).json(subscription);
		} catch (error) {
			logger.error("Error creating subscription:", error);
			res.status(500).json({ error: "Failed to create subscription" });
		}
	} catch (error) {
		logger.error("Error creating user subscription:", error);
		res.status(500).json({ error: "Failed to create user subscription" });
	}
});

app.put("/api/user-subscriptions/:id", async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const { active } = req.body;

		if (isNaN(id)) {
			return res.status(400).json({ error: "Invalid subscription ID" });
		}

		if (active === undefined) {
			return res.status(400).json({ error: "Active status is required" });
		}

		const subscription = await prisma.userSubscription.update({
			where: { id },
			data: { active },
		});

		res.json(subscription);
	} catch (error) {
		logger.error("Error updating user subscription:", error);
		res.status(500).json({ error: "Failed to update user subscription" });
	}
});

app.delete("/api/user-subscriptions/:id", async (req, res) => {
	try {
		const id = parseInt(req.params.id);

		if (isNaN(id)) {
			return res.status(400).json({ error: "Invalid subscription ID" });
		}

		const subscription = await prisma.userSubscription.update({
			where: { id },
			data: { active: false },
		});

		res.json(subscription);
	} catch (error) {
		logger.error("Error deleting user subscription:", error);
		res.status(500).json({ error: "Failed to delete user subscription" });
	}
});

app.get("/api/analyses", async (req, res) => {
	try {
		const analyses = await prisma.analysisResult.findMany({
			orderBy: {
				processedAt: "desc",
			},
			include: {
				post: {
					include: {
						account: true,
					},
				},
			},
			take: 50,
		});

		res.json(analyses);
	} catch (error) {
		logger.error("Error fetching analyses:", error);
		res.status(500).json({ error: "Failed to fetch analyses" });
	}
});

app.get("/api/trades", async (req, res) => {
	try {
		const trades = await prisma.trade.findMany({
			orderBy: {
				executedAt: "desc",
			},
			include: {
				analysis: true,
			},
			take: 50,
		});

		res.json(trades);
	} catch (error) {
		logger.error("Error fetching trades:", error);
		res.status(500).json({ error: "Failed to fetch trades" });
	}
});

// Forward AI analysis requests
app.post("/api/analyze", async (req, res) => {
	try {
		const response = await axios.post(
			`${AI_ANALYSIS_URL}/api/analyze`,
			req.body,
		);
		res.status(response.status).json(response.data);
	} catch (error) {
		logger.error("Error forwarding request to AI analysis service:", error);
		res.status(500).json({ error: "Failed to analyze post" });
	}
});

// Forward trading requests
app.post("/api/trade", async (req, res) => {
	try {
		const response = await axios.post(
			`${TRADING_ORCHESTRATOR_URL}/api/trade`,
			req.body,
		);
		res.status(response.status).json(response.data);
	} catch (error) {
		logger.error("Error forwarding request to trading orchestrator:", error);
		res.status(500).json({ error: "Failed to execute trade" });
	}
});

// Register a new subscription via API
app.post("/api/register-subscription", async (req, res) => {
	try {
		const { telegramId, tokenAddress, xHandle } = req.body;

		if (!telegramId || !tokenAddress || !xHandle) {
			return res.status(400).json({
				error: "Missing required fields",
				required: ["telegramId", "tokenAddress", "xHandle"],
			});
		}

		// Verify the token first
		try {
			const tokenResponse = await axios.post(
				`${TRADE_BOT_URL}/api/verify-token`,
				{
					tokenAddress,
				},
			);

			if (!tokenResponse.data || !tokenResponse.data.valid) {
				return res.status(400).json({ error: "Invalid token address" });
			}

			const tokenInfo = tokenResponse.data.tokenInfo;

			// Register the X account
			const accountResponse = await axios.post(
				`${X_MONITORING_URL}/api/accounts`,
				{
					username: xHandle.startsWith("@") ? xHandle.substring(1) : xHandle,
				},
			);

			if (!accountResponse.data || !accountResponse.data.id) {
				return res.status(500).json({ error: "Failed to register X account" });
			}

			// Create the subscription
			const subscriptionResponse = await axios.post(
				`${TRADE_BOT_URL}/api/subscription`,
				{
					telegramId,
					tokenAddress,
					tokenInfo,
					accountId: accountResponse.data.id,
				},
			);

			res.status(201).json(subscriptionResponse.data);
		} catch (error) {
			logger.error("Error registering subscription:", error);
			res.status(500).json({ error: "Failed to register subscription" });
		}
	} catch (error) {
		logger.error("Error processing registration:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// Get system status
app.get("/api/system-status", async (req, res) => {
	try {
		const services = [
			{ name: "api-gateway", url: "/health" },
			{ name: "x-monitoring", url: `${X_MONITORING_URL}/health` },
			{ name: "ai-analysis", url: `${AI_ANALYSIS_URL}/health` },
			{ name: "trade-bot", url: `${TRADE_BOT_URL}/health` },
			{
				name: "trading-orchestrator",
				url: `${TRADING_ORCHESTRATOR_URL}/health`,
			},
		];

		const status = {};

		for (const service of services) {
			try {
				const serviceUrl =
					service.name === "api-gateway"
						? `http://localhost:${PORT}${service.url}`
						: service.url;
				const response = await axios.get(serviceUrl, { timeout: 5000 });
				(status as Record<string, any>)[service.name] = {
					status: response.status === 200 ? "ok" : "error",
					details: response.data,
				};
			} catch (error: any) {
				(status as Record<string, any>)[service.name] = {
					status: "error",
					details: { error: error.message },
				};
			}
		}

		// Check database
		try {
			await prisma.$queryRaw`SELECT 1`;
			(status as Record<string, any>)["database"] = { status: "ok" };
		} catch (dbError: any) {
			(status as Record<string, any>)["database"] = {
				status: "error",
				details: { error: dbError.message },
			};
		}

		res.json({
			timestamp: new Date().toISOString(),
			services: status,
		});
	} catch (error) {
		logger.error("Error checking system status:", error);
		res.status(500).json({ error: "Failed to check system status" });
	}
});

app.use(express.static("public"));

app.get("*", (req, res) => {
	res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, () => {
	logger.info(`API Gateway running on port ${PORT}`);
});

import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import express from "express";
import { getUserFromTwitter } from "../utils/twitter.js";
import { cleanupInvalidAccounts } from "../utils/database.js";

const router = express.Router();
const logger = createLogger("accounts-router");

// Get all accounts
router.get("/", async (req, res) => {
	try {
		const accounts = await prisma.monitoredAccount.findMany();
		res.json(accounts);
	} catch (error) {
		logger.error("Error fetching accounts:", error);
		res.status(500).json({ error: "Failed to fetch accounts" });
	}
});

// Add new account
router.post("/", async (req, res) => {
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

// Get active accounts (accounts with active subscriptions)
router.get("/active", async (req, res) => {
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

// Refresh account data from Twitter
router.post("/:id/refresh", async (req, res) => {
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

// Cleanup invalid accounts
router.post("/cleanup", async (req, res) => {
	try {
		logger.info("Manual account cleanup triggered");
		await cleanupInvalidAccounts();
		res.status(200).json({ message: "Account cleanup completed" });
	} catch (error) {
		logger.error("Error during manual account cleanup:", error);
		res.status(500).json({ error: "Failed to clean up accounts" });
	}
});

export default router;
import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import express from "express";

const router = express.Router();
const logger = createLogger("subscriptions-router");

// Get subscriptions with optional filtering
router.get("/", async (req, res) => {
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

export default router;

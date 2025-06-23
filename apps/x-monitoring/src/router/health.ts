import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import express from "express";

const router = express.Router();
const logger = createLogger("health-router");

router.get("/health", async (req, res) => {
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

export default router; 
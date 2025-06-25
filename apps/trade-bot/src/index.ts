import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import { Telegraf } from "telegraf";
import { setupBotCommands } from "./commands";
import { postRouter } from "./routes/webhook/postRouter";

dotenv.config();

const PORT = process.env.PORT || 3002;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!TELEGRAM_BOT_TOKEN) {
	console.error("TELEGRAM_BOT_TOKEN is required");
	process.exit(1);
}

const app = express();
export const logger = createLogger("trade-bot");
export const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

setupBotCommands(bot, logger);

app.use(express.json());

// Connect the webhook router
app.use("/api", postRouter);

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

bot
	.launch()
	.then(() => {
		logger.info("Telegram bot started");
	})
	.catch((error) => {
		logger.error("Failed to start Telegram bot:", error);
		process.exit(1);
	});

app.listen(PORT, () => {
	logger.info(`Telegram Bot Service running on port ${PORT}`);
});

process.once("SIGINT", () => {
	bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
	bot.stop("SIGTERM");
});

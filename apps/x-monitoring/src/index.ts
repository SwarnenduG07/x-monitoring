import { createLogger } from "@believe-x/shared";
import dotenv from "dotenv";
import express from "express";

// Import routers
import healthRouter from "./router/health.js";
import accountsRouter from "./router/accounts.js";
import subscriptionsRouter from "./router/subscriptions.js";

// Import services
import { startMonitoring } from "./services/monitoringService.js";
import { cleanupInvalidAccounts } from "./utils/database.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();
const logger = createLogger("x-monitoring");

// Middleware
app.use(express.json());

// Routes
app.use(healthRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/subscriptions", subscriptionsRouter);

// Start server

app.listen(PORT, () => {
	logger.info(`X Monitoring Service running on port ${PORT}`);

	// Initialize application
	cleanupInvalidAccounts().then(() => {
		startMonitoring();
	});
});

export default app;

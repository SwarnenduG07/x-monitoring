import { createLogger } from "@believe-x/shared";
import dotenv from "dotenv";
import express from "express";

import healthRouter from "./router/health.js";
import accountsRouter from "./router/accounts.js";
import subscriptionsRouter from "./router/subscriptions.js";

import { startMonitoring } from "./services/monitoringService.js";
import { cleanupInvalidAccounts } from "./utils/database.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();
const logger = createLogger("x-monitoring");

app.use(express.json());

app.use(healthRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/subscriptions", subscriptionsRouter);

app.listen(PORT, () => {
	logger.info(`X Monitoring Service running on port ${PORT}`);

	cleanupInvalidAccounts().then(() => {
		startMonitoring();
	});
});

export default app;

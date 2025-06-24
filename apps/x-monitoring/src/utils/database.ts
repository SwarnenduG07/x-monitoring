import { prisma } from "@believe-x/database";
import { createLogger } from "@believe-x/shared";
import { getUserFromTwitter } from "./twitter.js";

const logger = createLogger("database-utils");

export async function cleanupInvalidAccounts() {
	try {
		logger.info("Starting cleanup of invalid accounts...");

		const accounts = await prisma.monitoredAccount.findMany();
		let fixedCount = 0;

		for (const account of accounts) {
			if (
				account.xAccountId.includes("placeholder_") ||
				!account.xAccountId.match(/^[0-9]+$/) || 
				account.xAccountId.length < 5
			) {
				
				logger.warn(
					`Found invalid Twitter ID format: ${account.xAccountId} for user ${account.xUsername}`,
				);

				try {
					const userData = await getUserFromTwitter(account.xUsername);

					if (userData && userData.id) {
						// Check if an account with this real Twitter ID already exists
						const existingAccount = await prisma.monitoredAccount.findFirst({
							where: {
								xAccountId: userData.id,
								id: { not: account.id }, // Exclude current account
							},
						});

						if (existingAccount) {
							logger.info(
								`Account with Twitter ID ${userData.id} already exists for ${existingAccount.xUsername}. Merging subscriptions and deleting duplicate.`
							);

							// Move all subscriptions from placeholder account to existing account
							await prisma.userSubscription.updateMany({
								where: { accountId: account.id },
								data: { accountId: existingAccount.id },
							});

							// Move all posts from placeholder account to existing account
							await prisma.post.updateMany({
								where: { accountId: account.id },
								data: { accountId: existingAccount.id },
							});

							// Delete the placeholder account
							await prisma.monitoredAccount.delete({
								where: { id: account.id },
							});

							logger.info(
								`Successfully merged placeholder account ${account.xUsername} into existing account ${existingAccount.xUsername}`
							);
						} else {
							// Safe to update - no conflict
							await prisma.monitoredAccount.update({
								where: { id: account.id },
								data: {
									xAccountId: userData.id,
									xUsername: userData.username || account.xUsername,
									displayName: userData.name || account.displayName,
								},
							});

							logger.info(
								`Fixed account data for ${account.xUsername}, updated ID from ${account.xAccountId} to ${userData.id}`,
							);
						}
						fixedCount++;
					} else {
						logger.error(
							`Could not find Twitter user for ${account.xUsername}. Consider removing this account.`
						);
					}
				} catch (error) {
					logger.error(`Error fixing account ${account.xUsername}:`, error);
				}
			}
		}

		logger.info(`Account cleanup complete. Fixed ${fixedCount} accounts.`);
	} catch (error) {
		logger.error("Error during account cleanup:", error);
	}
}

export async function checkAndFixAccounts() {
	try {
		logger.info("Checking for invalid accounts...");

		const accounts = await prisma.monitoredAccount.findMany();

		for (const account of accounts) {
			try {
				const { verifyTwitterUserId } = await import("./twitter.js");
				const isValid = await verifyTwitterUserId(account.xAccountId);

				if (!isValid) {
					logger.warn(
						`Invalid Twitter user ID found for ${account.xUsername}: ${account.xAccountId}`,
					);

					// Try to refresh the account data
					try {
						const userData = await getUserFromTwitter(account.xUsername);

						if (userData && userData.id) {
							// Update with correct ID
							await prisma.monitoredAccount.update({
								where: { id: account.id },
								data: {
									xAccountId: userData.id,
									xUsername: userData.username || account.xUsername,
									displayName: userData.name || account.displayName,
								},
							});

							logger.info(
								`Fixed account data for ${account.xUsername}, updated ID: ${userData.id}`,
							);
						}
					} catch (refreshError) {
						logger.error(
							`Could not refresh data for ${account.xUsername}:`,
							refreshError,
						);
					}
				}
			} catch (verifyError) {
				logger.error(
					`Error verifying account ${account.xUsername}:`,
					verifyError,
				);
			}
		}

		logger.info("Account verification complete");
	} catch (error) {
		logger.error("Error checking accounts:", error);
	}
} 
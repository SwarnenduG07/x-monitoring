#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Initialize the database package
 */
function init() {
	console.log("📦 Initializing database package...");

	// Check if .env file exists
	const envPath = path.join(__dirname, "../../../.env");
	if (!fs.existsSync(envPath)) {
		console.log(
			"⚠️ No .env file found at the project root. Creating from example...",
		);
		try {
			const exampleEnvPath = path.join(__dirname, "../../../.env.example");
			if (fs.existsSync(exampleEnvPath)) {
				fs.copyFileSync(exampleEnvPath, envPath);
				console.log("✅ Created .env file from .env.example");
			} else {
				console.log(
					"⚠️ No .env.example file found. You will need to create a .env file manually.",
				);
			}
		} catch (error) {
			console.error("❌ Error creating .env file:", error.message);
		}
	}

	// Generate Prisma client
	console.log("🔄 Generating Prisma client...");
	try {
		execSync("npx prisma generate", {
			stdio: "inherit",
			cwd: path.join(__dirname, ".."),
		});
		console.log("✅ Prisma client generated successfully");
	} catch (error) {
		console.error("❌ Error generating Prisma client:", error.message);
		process.exit(1);
	}

	// Push schema to database
	console.log("🔄 Pushing schema to database...");
	try {
		execSync("npx prisma db push", {
			stdio: "inherit",
			cwd: path.join(__dirname, ".."),
		});
		console.log("✅ Database schema pushed successfully");
	} catch (error) {
		console.error("❌ Error pushing schema to database:", error.message);
		console.log(
			"💡 Make sure your database is running and DATABASE_URL is correctly set in your .env file",
		);
		process.exit(1);
	}

	console.log("🎉 Database package initialized successfully!");
	console.log("");
	console.log("Next steps:");
	console.log("  1. Run `npm run db:studio` to explore your database");
	console.log(
		"  2. Import { prisma } from '@believe-x/database' in your services",
	);
}

// Run the initialization
init();

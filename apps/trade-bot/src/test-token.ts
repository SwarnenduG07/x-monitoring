import dotenv from "dotenv";
import { verifySolanaToken } from "./service/solana-token-verification";

dotenv.config();

async function testTokenVerification() {
	const tokenAddress =
		process.argv[2] || "Es9vMFrzaCERCLwKzHnh6mFYHTxgdRJrQbz6bG3y5QNo";

	console.log(`Testing verification for token: ${tokenAddress}`);

	try {
		const tokenInfo = await verifySolanaToken(tokenAddress);

		if (tokenInfo) {
			console.log("✅ Token verified successfully:");
			console.log(JSON.stringify(tokenInfo, null, 2));
		} else {
			console.log("❌ Failed to verify token");
		}
	} catch (error) {
		console.error("Error during verification:", error);
	}

	process.exit(0);
}

testTokenVerification();

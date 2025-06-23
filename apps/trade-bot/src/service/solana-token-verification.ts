import { createLogger } from "@believe-x/shared";
import axios from "axios";

const logger = createLogger("solana-token-verification");


export interface SolanaTokenInfo {
	address: string;
	symbol: string;
	name?: string;
	decimals?: number;
	market?: boolean;
}


const KNOWN_TOKENS: Record<string, SolanaTokenInfo> = {
	Es9vMFrzaCERCLwKzHnh6mFYHTxgdRJrQbz6bG3y5QNo: {
		address: "Es9vMFrzaCERCLwKzHnh6mFYHTxgdRJrQbz6bG3y5QNo",
		symbol: "USDC",
		name: "USD Coin",
		decimals: 6,
		market: true,
	},
	So11111111111111111111111111111111111111112: {
		address: "So11111111111111111111111111111111111111112",
		symbol: "SOL",
		name: "Solana",
		decimals: 9,
		market: true,
	},
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
		address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		symbol: "USDC",
		name: "USD Coin (Portal)",
		decimals: 6,
		market: true,
	},
	DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
		address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
		symbol: "BONK",
		name: "Bonk",
		decimals: 5,
		market: true,
	},
};

/**
 * Verify a Solana token address
 */
export async function verifySolanaToken(
	address: string,
): Promise<SolanaTokenInfo | null> {
	try {
		logger.info(`Verifying Solana token: ${address}`);

		// Check if it's a known token
		if (KNOWN_TOKENS[address]) {
			logger.info(`Found in known tokens: ${KNOWN_TOKENS[address].symbol}`);
			return KNOWN_TOKENS[address];
		}

		// Try multiple APIs in sequence
		return await tryMultipleAPIs(address);
	} catch (error: any) {
		logger.error(`Token verification failed: ${error.message}`);
		return null;
	}
}

/**
 * Try multiple APIs to verify token
 */
async function tryMultipleAPIs(
	address: string,
): Promise<SolanaTokenInfo | null> {
	// Try Jupiter API first (most reliable)
	try {
		logger.info(`Trying Jupiter API for ${address}`);
		const jupiterResponse = await axios.get("https://token.jup.ag/all", {
			timeout: 10000,
		});

		if (jupiterResponse.data && Array.isArray(jupiterResponse.data)) {
			const token = jupiterResponse.data.find(
				(t: any) => t.address === address,
			);

			if (token) {
				logger.info(`Token verified via Jupiter: ${token.symbol}`);
				return {
					address,
					symbol: token.symbol,
					name: token.name || token.symbol,
					decimals: token.decimals || 9,
					market: true, 
				};
			}
		}
	} catch (error: any) {
		logger.warn(`Jupiter API error: ${error.message}`);
	}

	// Try Solscan API
	try {
		logger.info(`Trying Solscan API for ${address}`);
		const solscanResponse = await axios.get(
			`https://public-api.solscan.io/token/meta?tokenAddress=${address}`,
			{
				headers: {
					Accept: "application/json",
				},
				timeout: 10000,
			},
		);

		if (solscanResponse.data && solscanResponse.data.symbol) {
			logger.info(`Token verified via Solscan: ${solscanResponse.data.symbol}`);

			// Check market data
			const hasMarket = await checkTokenMarket(address);

			return {
				address,
				symbol: solscanResponse.data.symbol,
				name: solscanResponse.data.name || solscanResponse.data.symbol,
				decimals: solscanResponse.data.decimals || 9,
				market: hasMarket,
			};
		}
	} catch (error: any) {
		logger.warn(`Solscan API error: ${error.message}`);
	}

	// Try Dexscreener directly
	try {
		logger.info(`Trying Dexscreener API for ${address}`);
		const dexscreenerResponse = await axios.get(
			`https://api.dexscreener.com/latest/dex/tokens/${address}`,
			{
				timeout: 10000,
			},
		);

		if (
			dexscreenerResponse.data &&
			dexscreenerResponse.data.pairs &&
			dexscreenerResponse.data.pairs.length > 0
		) {
			const pair = dexscreenerResponse.data.pairs[0];
			const tokenData =
				pair.baseToken.address.toLowerCase() === address.toLowerCase()
					? pair.baseToken
					: pair.quoteToken;

			logger.info(`Token verified via Dexscreener: ${tokenData.symbol}`);

			return {
				address,
				symbol: tokenData.symbol,
				name: tokenData.name || tokenData.symbol,
				decimals: 9, // Default for Solana
				market: true,
			};
		}
	} catch (error: any) {
		logger.warn(`Dexscreener API error: ${error.message}`);
	}

	// Try Birdeye API as last resort
	try {
		logger.info(`Trying Birdeye API for ${address}`);
		const birdeyeResponse = await axios.get(
			`https://public-api.birdeye.so/public/tokenlist?blockchain=solana`,
			{
				timeout: 10000,
			},
		);

		if (
			birdeyeResponse.data &&
			birdeyeResponse.data.data &&
			Array.isArray(birdeyeResponse.data.data)
		) {
			const token = birdeyeResponse.data.data.find(
				(t: any) => t.address === address,
			);

			if (token) {
				logger.info(`Token verified via Birdeye: ${token.symbol}`);
				return {
					address,
					symbol: token.symbol,
					name: token.name || token.symbol,
					decimals: token.decimals || 9,
					market: true,
				};
			}
		}
	} catch (error: any) {
		logger.warn(`Birdeye API error: ${error.message}`);
	}

	return null;
}

/**
 * Check if token has market activity
 */
async function checkTokenMarket(address: string): Promise<boolean> {
	try {
		const response = await axios.get(
			`https://api.dexscreener.com/latest/dex/tokens/${address}`,
			{
				timeout: 5000,
			},
		);

		return !!(
			response.data &&
			response.data.pairs &&
			response.data.pairs.length > 0
		);
	} catch (error: any) {
		logger.warn(`Market check failed: ${error.message}`);
		return false;
	}
}

/**
 * Get token info by symbol (using Jupiter API)
 */
export async function getTokenBySymbol(
	symbol: string,
): Promise<SolanaTokenInfo | null> {
	try {
		// Check known tokens first
		for (const address in KNOWN_TOKENS) {
			if (KNOWN_TOKENS[address].symbol.toUpperCase() === symbol.toUpperCase()) {
				return KNOWN_TOKENS[address];
			}
		}

		// Try Jupiter API
		const jupiterResponse = await axios.get("https://token.jup.ag/all", {
			timeout: 10000,
		});

		if (jupiterResponse.data && Array.isArray(jupiterResponse.data)) {
			const token = jupiterResponse.data.find(
				(t: any) => t.symbol.toUpperCase() === symbol.toUpperCase(),
			);

			if (token) {
				return {
					address: token.address,
					symbol: token.symbol,
					name: token.name || token.symbol,
					decimals: token.decimals || 9,
					market: true,
				};
			}
		}

		return null;
	} catch (error) {
		logger.error(`Error getting token by symbol ${symbol}:`, error);
		return null;
	}
}

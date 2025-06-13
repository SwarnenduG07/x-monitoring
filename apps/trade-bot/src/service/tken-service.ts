import axios from 'axios';
import { createLogger } from '@believe-x/shared';
import { prisma } from '@believe-x/database';

const logger = createLogger('token-service');

// Supported chains
const SUPPORTED_CHAINS = {
  ETHEREUM: 1,
  SOLANA: 101,
  // Add more chains as needed
};

// Token verification API endpoints
const API_ENDPOINTS = {
  ETHEREUM: 'https://api.etherscan.io/api',
  SOLANA: 'https://public-api.solscan.io/token',
  // Add more APIs as needed
};

// API keys
const API_KEYS = {
  ETHEREUM: process.env.ETHERSCAN_API_KEY || '',
  SOLANA: process.env.SOLSCAN_API_KEY || '',
  // Add more API keys as needed
};

/**
 * Verify if a token address is valid and get its details
 * @param address Token address
 * @param chainId Chain ID (default: Ethereum)
 * @returns Token details or null if invalid
 */
export async function verifyTokenAddress(address: string, chainId: number = SUPPORTED_CHAINS.ETHEREUM): Promise<any | null> {
  try {
    // Check if token already exists in database
    const existingToken = await prisma.token.findFirst({
      where: {
        address,
        chainId
      }
    });

    if (existingToken) {
      logger.info(`Token found in database: ${existingToken.symbol} (${existingToken.address})`);
      return existingToken;
    }

    
    let tokenData;
    
      if (chainId === SUPPORTED_CHAINS.SOLANA) {
      tokenData = await verifySolanaToken(address);
    } else {
      logger.error(`Unsupported chain ID: ${chainId}`);
      return null;
    }

    if (!tokenData) {
      return null;
    }

    const token = await prisma.token.create({
      data: {
        address,
        symbol: tokenData.symbol,
        name: tokenData.name,
        chainId,
        decimals: tokenData.decimals || 18
      }
    });

    logger.info(`New token verified and saved: ${token.symbol} (${token.address})`);
    return token;
  } catch (error) {
    logger.error(`Error verifying token address ${address}:`, error);
    return null;
  }
}
/**
 * Verify a Solana token address
 * @param address Solana token address (mint)
 * @returns Token data or null if invalid
 */

async function verifySolanaToken(address: string): Promise<any | null> {
  try {
    if (!address.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      logger.error(`Invalid Solana address format: ${address}`);
      return null;
    }

    const response = await axios.get(`${API_ENDPOINTS.SOLANA}/${address}`);

    if (!response.data || !response.data.symbol) {
      logger.error(`Token verification failed: Invalid Solana token`);
      return null;
    }

    return {
      symbol: response.data.symbol,
      name: response.data.name || response.data.symbol,
      decimals: response.data.decimals || 9
    };
  } catch (error) {
    logger.error(`Error verifying Solana token:`, error);
    return null;
  }
}

/**
 * Get token by symbol
 * @param symbol Token symbol
 * @returns Token or null if not found
 */
export async function getTokenBySymbol(symbol: string): Promise<any | null> {
  try {
    const token = await prisma.token.findFirst({
      where: {
        symbol: {
          equals: symbol,
          mode: 'insensitive'
        }
      }
    });
    
    return token;
  } catch (error) {
    logger.error(`Error getting token by symbol ${symbol}:`, error);
    return null;
  }
}

/**
 * Get token by ID
 * @param id Token ID
 * @returns Token or null if not found
 */
export async function getTokenById(id: number): Promise<any | null> {
  try {
    const token = await prisma.token.findUnique({
      where: { id }
    });
    
    return token;
  } catch (error) {
    logger.error(`Error getting token by ID ${id}:`, error);
    return null;
  }
}

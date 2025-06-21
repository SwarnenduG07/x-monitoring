// Interfaces for X Monitoring Service
export interface XPost {
	id: string;
	text: string;
	authorId: string;
	authorUsername: string;
	authorDisplayName: string;
	createdAt: string;
	url: string;
}

export interface MonitoredAccount {
	id: number;
	xAccountId: string;
	xUsername: string;
	displayName?: string;
	createdAt: Date;
	updatedAt: Date;
}

// Interfaces for AI Analysis Service
export interface AnalysisResult {
	postId: number;
	sentimentScore: number; // Range from -1 to 1
	confidence: number; // Range from 0 to 1
	decision: "buy" | "sell" | "hold";
	reasons: {
		positiveSignals: string[];
		negativeSignals: string[];
		neutralSignals: string[];
	};
	marketConditions?: {
		overallMarketSentiment?: string;
		relatedTokens?: {
			symbol: string;
			sentiment: number;
		}[];
	};
	processedAt: Date;
}

export interface AnalysisRequest {
	postId: number;
	postText: string;
	authorUsername: string;
	authorDisplayName?: string;
	postUrl: string;
	timestamp: string;
}

export interface AnalysisResponse {
	analysisId: number;
	postId: number;
	sentimentScore: number;
	confidence: number;
	decision: "buy" | "sell" | "hold";
	reasons: {
		positiveSignals: string[];
		negativeSignals: string[];
		neutralSignals: string[];
	};
	marketConditions?: {
		overallMarketSentiment?: string;
		relatedTokens?: {
			symbol: string;
			sentiment: number;
		}[];
	};
}

// Interfaces for Trading Orchestrator
export interface TradeRequest {
	analysisId: number;
	postId: number;
	tokenSymbol: string;
	confidence: number;
	decision: "buy" | "sell" | "hold";
}

export interface TradeResult {
	id: number;
	uuid: string;
	analysisId: number;
	tokenSymbol: string;
	tokenAmount: number;
	priceUsd: number;
	transactionHash?: string;
	isPaperTrade: boolean;
	status: "pending" | "completed" | "failed";
	executedAt: Date;
	errorMessage?: string;
}

// Interfaces for Notification Service
export interface NotificationMessage {
	type: "new_post" | "analysis_result" | "trade_execution" | "system_alert";
	title: string;
	message: string;
	data?: any;
	timestamp: Date;
}

// Shared interfaces for Redis pub/sub
export interface RedisMessage<T> {
	topic: string;
	data: T;
	timestamp: Date;
	messageId: string;
}

// Redis pub/sub topics
export enum RedisTopic {
	NEW_POST = "new-post",
	ANALYSIS_RESULT = "analysis-result",
	TRADE_EXECUTION = "trade-execution",
	NOTIFICATION = "notification",
	SYSTEM_ALERT = "system-alert",
	MARKET_UPDATE = "market-update",
}

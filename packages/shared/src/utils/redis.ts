import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import type { RedisMessage, RedisTopic } from "../types";
import { createLogger } from "./logger";

const logger = createLogger("redis");

class RedisService {
	private publisher: Redis;
	private subscriber: Redis;
	private subscriptions: Map<string, Set<(data: any) => void>> = new Map();

	constructor(redisUrl: string) {
		this.publisher = new Redis(redisUrl);
		this.subscriber = new Redis(redisUrl);

		this.subscriber.on("message", (channel, message) => {
			try {
				const parsedMessage = JSON.parse(message) as RedisMessage<any>;
				const handlers = this.subscriptions.get(channel);

				if (handlers) {
					handlers.forEach((handler) => {
						try {
							handler(parsedMessage.data);
						} catch (err) {
							logger.error(
								`Error in Redis handler for channel ${channel}:`,
								err,
							);
						}
					});
				}
			} catch (err) {
				logger.error(`Error parsing Redis message on channel ${channel}:`, err);
			}
		});
	}

	async publish<T>(topic: RedisTopic, data: T): Promise<string> {
		const messageId = uuidv4();
		const message: RedisMessage<T> = {
			topic,
			data,
			timestamp: new Date(),
			messageId,
		};

		await this.publisher.publish(topic, JSON.stringify(message));
		return messageId;
	}

	subscribe<T>(topic: RedisTopic, handler: (data: T) => void): () => void {
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, new Set());
			this.subscriber.subscribe(topic);
		}

		const handlers = this.subscriptions.get(topic)!;
		handlers.add(handler as any);

		// Return unsubscribe function
		return () => {
			handlers.delete(handler as any);

			if (handlers.size === 0) {
				this.subscriptions.delete(topic);
				this.subscriber.unsubscribe(topic);
			}
		};
	}

	async disconnect(): Promise<void> {
		await this.publisher.quit();
		await this.subscriber.quit();
	}
}

export const createRedisService = (
	redisUrl: string = process.env.REDIS_URL || "redis://localhost:6379",
): RedisService => {
	return new RedisService(redisUrl);
};

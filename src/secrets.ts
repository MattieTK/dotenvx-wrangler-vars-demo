/**
 * secrets.ts
 *
 * Simple API for accessing decrypted secrets in Cloudflare Workers.
 * Preserves all bindings (D1, Durable Objects, KV, R2, etc.) while
 * decrypting dotenvx-encrypted string values.
 *
 * Usage:
 * 1. Call withSecrets(env, handler) to wrap your request handler
 * 2. Import and call getSecret('KEY') from anywhere in your code
 * 3. Use getBinding<T>('NAME') to access typed bindings
 *
 * @example
 * ```ts
 * // In your handler:
 * import { withSecrets } from './secrets';
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     return withSecrets(env, async () => {
 *       return handleRequest(request);
 *     });
 *   }
 * }
 *
 * // In any other file:
 * import { getSecret, getBinding } from './secrets';
 *
 * async function doSomething() {
 *   const apiKey = getSecret('API_KEY');
 *   const db = getBinding<D1Database>('DB');
 *   const kv = getBinding<KVNamespace>('MY_KV');
 * }
 * ```
 */

import dotenvx from '@dotenvx/dotenvx';
import { AsyncLocalStorage } from 'node:async_hooks';

// Store for the current request's env (with decrypted secrets)
const envStore = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Decrypts a single value using dotenvx
 */
function decrypt(key: string, value: string, privateKey: string, publicKey?: string): string {
	const envString = `${key}="${value}"`;
	const parsed = dotenvx.parse(envString, { privateKey, publicKey });
	return parsed[key] ?? value;
}

/**
 * Initialize secrets for the current request context.
 * Decrypts encrypted string values while preserving all bindings.
 *
 * @param env - The Cloudflare Worker env object
 * @param handler - Your request handler function
 * @returns The result of your handler
 *
 * @example
 * ```ts
 * export default {
 *   async fetch(request, env, ctx) {
 *     return withSecrets(env, async () => {
 *       // getSecret() and getBinding() work here
 *       return handleRequest(request);
 *     });
 *   }
 * }
 * ```
 */
export function withSecrets<T>(env: Record<string, unknown>, handler: () => T): T {
	const privateKey = env.DOTENV_PRIVATE_KEY as string;
	const publicKey = env.DOTENV_PUBLIC_KEY as string | undefined;

	// Create a new env object with decrypted secrets
	// Non-string values (bindings) pass through unchanged
	const processedEnv: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(env)) {
		if (typeof value === 'string' && value.startsWith('encrypted:') && privateKey) {
			try {
				processedEnv[key] = decrypt(key, value, privateKey, publicKey);
			} catch (error) {
				console.error(`[secrets] Failed to decrypt ${key}:`, error);
				processedEnv[key] = value;
			}
		} else {
			// Preserve bindings (D1, KV, Durable Objects, etc.) and plain strings
			processedEnv[key] = value;
		}
	}

	return envStore.run(processedEnv, handler);
}

/**
 * Get a decrypted secret value (string vars only).
 * Must be called within a withSecrets() context.
 *
 * @param key - The secret name
 * @returns The decrypted value, or undefined if not found
 * @throws Error if called outside of withSecrets() context
 *
 * @example
 * ```ts
 * const apiKey = getSecret('API_KEY');
 * const dbUrl = getSecret('DATABASE_URL');
 * ```
 */
export function getSecret(key: string): string | undefined {
	const env = envStore.getStore();

	if (!env) {
		throw new Error('[secrets] getSecret() called outside of withSecrets() context');
	}

	const value = env[key];
	return typeof value === 'string' ? value : undefined;
}

/**
 * Get a required secret - throws if not found.
 *
 * @param key - The secret name
 * @returns The decrypted value
 * @throws Error if secret is not found or not initialized
 */
export function requireSecret(key: string): string {
	const value = getSecret(key);

	if (value === undefined) {
		throw new Error(`[secrets] Required secret "${key}" not found`);
	}

	return value;
}

/**
 * Get a binding (D1, KV, Durable Objects, R2, Queues, etc.)
 * Must be called within a withSecrets() context.
 *
 * @param key - The binding name
 * @returns The binding, typed as T
 * @throws Error if called outside of withSecrets() context
 *
 * @example
 * ```ts
 * const db = getBinding<D1Database>('DB');
 * const kv = getBinding<KVNamespace>('MY_KV');
 * const bucket = getBinding<R2Bucket>('MY_BUCKET');
 * const durableObject = getBinding<DurableObjectNamespace>('MY_DO');
 * ```
 */
export function getBinding<T>(key: string): T {
	const env = envStore.getStore();

	if (!env) {
		throw new Error('[secrets] getBinding() called outside of withSecrets() context');
	}

	return env[key] as T;
}

/**
 * Get the full env object with decrypted secrets.
 * Useful when you need to pass env to libraries or access multiple values.
 *
 * @returns The env object with all bindings and decrypted secrets
 */
export function getEnv<T = Record<string, unknown>>(): T {
	const env = envStore.getStore();

	if (!env) {
		throw new Error('[secrets] getEnv() called outside of withSecrets() context');
	}

	return env as T;
}

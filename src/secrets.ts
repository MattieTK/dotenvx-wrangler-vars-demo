/**
 * secrets.ts
 *
 * Simple API for accessing decrypted secrets in Cloudflare Workers.
 *
 * Usage:
 * 1. Call initSecrets(env) once at the start of your request handler
 * 2. Import and call getSecret('KEY') from anywhere in your code
 *
 * @example
 * ```ts
 * // In your handler:
 * import { initSecrets } from './secrets';
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     initSecrets(env);
 *     return handleRequest(request);
 *   }
 * }
 *
 * // In any other file:
 * import { getSecret } from './secrets';
 *
 * function doSomething() {
 *   const apiKey = getSecret('API_KEY');
 * }
 * ```
 */

import dotenvx from '@dotenvx/dotenvx';
import { AsyncLocalStorage } from 'node:async_hooks';

// Store for the current request's decrypted secrets
const secretsStore = new AsyncLocalStorage<Record<string, string>>();

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
 * Call this once at the start of your request handler.
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
 *       // getSecret() works here and in any called functions
 *       return handleRequest(request);
 *     });
 *   }
 * }
 * ```
 */
export function withSecrets<T>(env: Record<string, unknown>, handler: () => T): T {
	const privateKey = env.DOTENV_PRIVATE_KEY as string;
	const publicKey = env.DOTENV_PUBLIC_KEY as string | undefined;

	// Decrypt all encrypted values
	const secrets: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (typeof value === 'string') {
			if (value.startsWith('encrypted:') && privateKey) {
				try {
					secrets[key] = decrypt(key, value, privateKey, publicKey);
				} catch (error) {
					console.error(`[secrets] Failed to decrypt ${key}:`, error);
					secrets[key] = value;
				}
			} else {
				secrets[key] = value;
			}
		}
	}

	return secretsStore.run(secrets, handler);
}

/**
 * Get a decrypted secret value.
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
	const secrets = secretsStore.getStore();

	if (!secrets) {
		throw new Error('[secrets] getSecret() called outside of withSecrets() context. Wrap your handler with withSecrets(env, () => ...)');
	}

	return secrets[key];
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
 * Get all decrypted secrets.
 * Useful for debugging or passing to external libraries.
 */
export function getAllSecrets(): Record<string, string> {
	const secrets = secretsStore.getStore();

	if (!secrets) {
		throw new Error('[secrets] getAllSecrets() called outside of withSecrets() context');
	}

	return { ...secrets };
}

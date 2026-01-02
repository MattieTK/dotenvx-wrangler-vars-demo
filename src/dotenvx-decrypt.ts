/**
 * dotenvx-decrypt.ts
 *
 * Utility module for decrypting dotenvx-encrypted values from Cloudflare Worker env bindings.
 *
 * This enables a pattern where encrypted secrets can be stored directly in wrangler.jsonc
 * (safe to commit) while the private key remains a Cloudflare secret.
 */

import dotenvx from '@dotenvx/dotenvx';

export interface DecryptOptions {
	/** The private key for decryption (from Cloudflare secrets) */
	privateKey: string;
	/** The public key used for encryption (can be in wrangler.jsonc) */
	publicKey?: string;
}

/**
 * Decrypts a single dotenvx-encrypted value.
 *
 * @param key - The environment variable name
 * @param encryptedValue - The encrypted value (starts with "encrypted:")
 * @param options - Decryption options containing the private key
 * @returns The decrypted plaintext value
 *
 * @example
 * ```ts
 * const secret = decryptValue('API_KEY', env.API_KEY, {
 *   privateKey: env.DOTENV_PRIVATE_KEY
 * });
 * ```
 */
export function decryptValue(key: string, encryptedValue: string, options: DecryptOptions): string {
	// dotenvx.parse expects .env file format: KEY="value"
	const envString = `${key}="${encryptedValue}"`;

	const parsed = dotenvx.parse(envString, {
		privateKey: options.privateKey,
		publicKey: options.publicKey,
	});

	return parsed[key] ?? encryptedValue;
}

/**
 * Checks if a value is dotenvx-encrypted.
 */
export function isEncrypted(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('encrypted:');
}

/**
 * Decrypts all encrypted values in an env object.
 *
 * This function iterates through all properties in the env object and decrypts
 * any values that start with "encrypted:". Non-encrypted values pass through unchanged.
 *
 * @param env - The Cloudflare Worker env object
 * @returns A new object with all encrypted values decrypted
 *
 * @example
 * ```ts
 * export default {
 *   async fetch(request, env, ctx) {
 *     const secrets = decryptEnv(env);
 *     // secrets.MY_API_KEY is now decrypted
 *   }
 * }
 * ```
 */
export function decryptEnv<T extends Record<string, unknown>>(env: T): Record<string, string> {
	const privateKey = env.DOTENV_PRIVATE_KEY;
	const publicKey = env.DOTENV_PUBLIC_KEY;

	if (typeof privateKey !== 'string') {
		console.warn('[dotenvx] DOTENV_PRIVATE_KEY not found - encrypted values will not be decrypted');
		return env as Record<string, string>;
	}

	const decrypted: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (isEncrypted(value)) {
			try {
				decrypted[key] = decryptValue(key, value, {
					privateKey,
					publicKey: typeof publicKey === 'string' ? publicKey : undefined,
				});
			} catch (error) {
				console.error(`[dotenvx] Failed to decrypt ${key}:`, error);
				decrypted[key] = value; // Keep encrypted value on failure
			}
		} else if (typeof value === 'string') {
			decrypted[key] = value;
		}
	}

	return decrypted;
}

/**
 * Creates a lazy decryption proxy for the env object.
 *
 * Unlike decryptEnv(), this only decrypts values when they're accessed,
 * which can be more efficient if you don't need all secrets immediately.
 *
 * @param env - The Cloudflare Worker env object
 * @returns A proxy that decrypts values on access
 *
 * @example
 * ```ts
 * const secrets = createDecryptProxy(env);
 * // Decryption happens here, only when accessed:
 * console.log(secrets.MY_API_KEY);
 * ```
 */
export function createDecryptProxy<T extends Record<string, unknown>>(env: T): Record<string, string> {
	const cache = new Map<string, string>();
	const privateKey = env.DOTENV_PRIVATE_KEY as string;
	const publicKey = env.DOTENV_PUBLIC_KEY as string | undefined;

	return new Proxy(env as Record<string, string>, {
		get(target, prop: string) {
			if (cache.has(prop)) {
				return cache.get(prop);
			}

			const value = target[prop];

			if (isEncrypted(value)) {
				try {
					const decrypted = decryptValue(prop, value, { privateKey, publicKey });
					cache.set(prop, decrypted);
					return decrypted;
				} catch {
					return value;
				}
			}

			return value;
		},
	});
}

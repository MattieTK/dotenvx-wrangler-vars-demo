/**
 * Cloudflare Worker with dotenvx-encrypted secrets in wrangler.jsonc
 *
 * This demo shows how to store encrypted secrets directly in your Wrangler config
 * (safe to commit) and decrypt them at runtime using dotenvx.
 */

import { withSecrets, getSecret, getBinding, getEnv } from './secrets';

// Example: A separate function that needs access to secrets
// No need to pass env around - just import getSecret()
async function fetchFromExternalApi(): Promise<string> {
	const apiKey = getSecret('MY_SECRET');
	// In a real app, you'd use this to authenticate:
	// const response = await fetch('https://api.example.com', {
	//   headers: { 'Authorization': `Bearer ${apiKey}` }
	// });
	return `Would call API with key: ${apiKey?.substring(0, 10)}...`;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Wrap your handler with withSecrets() to enable getSecret() anywhere
		return withSecrets(env, async () => {
			const url = new URL(request.url);

			// Demo endpoints
			if (url.pathname === '/secret') {
				// Simple access from handler
				const secret = getSecret('MY_SECRET');
				return new Response(`Decrypted secret: ${secret}`);
			}

			if (url.pathname === '/external') {
				// Access from a separate function
				const result = await fetchFromExternalApi();
				return new Response(result);
			}

			if (url.pathname === '/debug') {
				// Show that bindings are preserved and secrets are decrypted
				const kv = getBinding<KVNamespace>('DEMO_KV');

				return Response.json({
					message: 'Environment inspection',
					secrets: {
						MY_SECRET_decrypted: getSecret('MY_SECRET')?.substring(0, 20) + '...',
						MY_SECRET_is_string: typeof getSecret('MY_SECRET') === 'string',
					},
					bindings_preserved: {
						// KV binding is an object, not destroyed by withSecrets()
						DEMO_KV_type: typeof kv,
						DEMO_KV_has_get_method: typeof kv?.get === 'function',
						DEMO_KV_has_put_method: typeof kv?.put === 'function',
					},
					note: 'Only strings starting with "encrypted:" are decrypted. Bindings (KV, D1, DO, etc.) pass through unchanged.',
				});
			}

			if (url.pathname === '/kv-test') {
				// Demonstrate KV actually works after withSecrets()
				const kv = getBinding<KVNamespace>('DEMO_KV');
				const testKey = 'test-key';

				// Write a value
				await kv.put(testKey, `Written at ${new Date().toISOString()}`);

				// Read it back
				const value = await kv.get(testKey);

				return Response.json({
					message: 'KV binding works correctly after withSecrets()',
					key: testKey,
					value: value,
					success: value !== null,
				});
			}

			// Default: show demo info
			return Response.json(
				{
					name: 'dotenvx-wrangler-vars-demo',
					description: 'Demonstrates encrypted secrets in wrangler.jsonc',
					endpoints: {
						'/secret': 'Shows the decrypted MY_SECRET value',
						'/external': 'Shows getSecret() used in a separate function',
						'/debug': 'Inspects env types (secrets vs bindings)',
						'/kv-test': 'Proves KV binding works after withSecrets()',
					},
					how_it_works: [
						'1. Encrypted values stored in wrangler.jsonc vars (safe to commit)',
						'2. DOTENV_PRIVATE_KEY stored as Cloudflare secret (never commit)',
						'3. withSecrets(env, handler) decrypts at request start',
						'4. getSecret(key) available anywhere in your code',
					],
				},
				{ headers: { 'Content-Type': 'application/json' } }
			);
		});
	},
} satisfies ExportedHandler<Env>;

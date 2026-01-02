# dotenvx + Wrangler Vars Demo

**Store encrypted secrets directly in `wrangler.jsonc` using dotenvx encryption.**

This demo shows an alternative pattern to the standard dotenvx Cloudflare integration. Instead of using encrypted `.env` files, you can store encrypted values directly in your Wrangler configuration.

## Why This Pattern?

| Approach | Config File | Secrets File | Pros | Cons |
|----------|-------------|--------------|------|------|
| **Standard dotenvx** | `wrangler.jsonc` | `.env` (encrypted) | Official approach, auto-decrypt | Two files to manage |
| **This pattern** | `wrangler.jsonc` with encrypted vars | None | Single config file, explicit | Requires helper code |

### When to Use This

- You want a single source of truth for configuration
- Your team prefers explicit decryption over magic imports
- You're already using Wrangler vars and want to encrypt some of them

### When NOT to Use This

- You have many secrets (dotenvx's `.env` file approach scales better)
- You want the standard dotenvx experience (`import '@dotenvx/dotenvx/config'`)

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  wrangler.jsonc (committed to git)                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ "vars": {                                                 │  │
│  │   "DOTENV_PUBLIC_KEY": "03d704...",                       │  │
│  │   "MY_SECRET": "encrypted:BHqsy5L4..."  ← Safe to commit  │  │
│  │ }                                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Secrets (never in git)                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ DOTENV_PRIVATE_KEY = "0f940d737..."  ← Decryption key     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  At Runtime                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ withSecrets(env, async () => {                            │  │
│  │   const secret = getSecret('MY_SECRET');                  │  │
│  │   // secret = "super-secret-value-123" (decrypted!)       │  │
│  │ });                                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install @dotenvx/dotenvx
```

### 2. Generate Encryption Keys

```bash
# Create a .env file with your secret
echo 'MY_SECRET="your-secret-value"' > .env

# Encrypt it (generates .env.keys with your private key)
npx dotenvx encrypt

# View the encrypted value
cat .env
# MY_SECRET="encrypted:BHqsy5L4..."
```

### 3. Add to wrangler.jsonc

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],  // Required!
  "vars": {
    "DOTENV_PUBLIC_KEY": "03d704...",        // From .env after encryption
    "MY_SECRET": "encrypted:BHqsy5L4..."     // The encrypted value
  }
}
```

### 4. Store Private Key as Cloudflare Secret

```bash
# For local development, add to .dev.vars:
echo 'DOTENV_PRIVATE_KEY=0f940d737...' >> .dev.vars

# For production:
wrangler secret put DOTENV_PRIVATE_KEY
# Paste your private key from .env.keys
```

### 5. Use in Your Worker

```typescript
import { withSecrets, getSecret } from './secrets';

export default {
  async fetch(request, env, ctx) {
    return withSecrets(env, async () => {
      // getSecret() works anywhere in this context
      const apiKey = getSecret('MY_SECRET');

      return new Response(`Secret: ${apiKey}`);
    });
  }
}
```

## API Reference

### `withSecrets(env, handler)`

Wraps your request handler to enable secret decryption. Must be called at the start of each request.

```typescript
withSecrets(env, async () => {
  // getSecret() is available here and in any called functions
});
```

### `getSecret(key)`

Returns the decrypted value of an encrypted secret, or the plain value for non-encrypted vars.

```typescript
const apiKey = getSecret('API_KEY');  // string | undefined
```

### `requireSecret(key)`

Like `getSecret()` but throws if the secret is not found.

```typescript
const apiKey = requireSecret('API_KEY');  // string (throws if missing)
```

### `getAllSecrets()`

Returns all decrypted secrets as an object. Useful for debugging or passing to libraries.

```typescript
const secrets = getAllSecrets();  // Record<string, string>
```

## Production Deployment

### 1. Set the Private Key Secret

```bash
wrangler secret put DOTENV_PRIVATE_KEY
```

When prompted, paste the private key from your `.env.keys` file.

### 2. Deploy

```bash
npm run deploy
```

### 3. Verify

```bash
curl https://your-worker.your-subdomain.workers.dev/secret
# Should show decrypted value
```

## Adding New Secrets

1. **Add to `.env`** (create if needed):
   ```
   NEW_SECRET="my-new-secret-value"
   ```

2. **Encrypt**:
   ```bash
   npx dotenvx encrypt
   ```

3. **Copy to `wrangler.jsonc`**:
   ```jsonc
   "vars": {
     "DOTENV_PUBLIC_KEY": "...",
     "MY_SECRET": "encrypted:...",
     "NEW_SECRET": "encrypted:..."  // Add this
   }
   ```

4. **Clean up** (optional):
   ```bash
   rm .env  # The encrypted values are now in wrangler.jsonc
   ```

## Security Considerations

### What's Safe to Commit

- ✅ `wrangler.jsonc` with encrypted values
- ✅ `DOTENV_PUBLIC_KEY` (encryption only, can't decrypt)
- ✅ The `secrets.ts` helper code

### What Must NEVER Be Committed

- ❌ `DOTENV_PRIVATE_KEY` (decryption key)
- ❌ `.env.keys` file
- ❌ `.dev.vars` file
- ❌ Plaintext `.env` files with secrets

### .gitignore

Ensure these are in your `.gitignore`:

```
.dev.vars
.env
.env.*
!.env.example
.env.keys
```

## Encryption Details

dotenvx uses:
- **ECIES** (Elliptic Curve Integrated Encryption Scheme)
- **secp256k1** curve (same as Bitcoin)
- **AES-256** for symmetric encryption

Each value is encrypted with a unique ephemeral key, providing forward secrecy.

## Limitations

1. **Requires `nodejs_compat`**: The dotenvx library uses Node.js crypto APIs
2. **Per-request initialization**: `withSecrets()` must be called for each request
3. **Bundle size**: dotenvx adds ~50KB to your Worker bundle

## Comparison with Standard Approach

### Standard dotenvx (encrypted .env file)

```typescript
// Automatic - just import at top of file
import '@dotenvx/dotenvx/config';

// Access via process.env
const secret = process.env.MY_SECRET;
```

### This pattern (encrypted wrangler vars)

```typescript
// Explicit initialization per request
return withSecrets(env, async () => {
  const secret = getSecret('MY_SECRET');
});
```

## Local Development

```bash
# Start dev server
npm run dev

# Test endpoints
curl http://localhost:8787/           # Info
curl http://localhost:8787/secret     # Show decrypted secret
curl http://localhost:8787/debug      # List all secrets
```

## Files Overview

```
├── src/
│   ├── index.ts          # Worker entry point with demo endpoints
│   ├── secrets.ts        # getSecret() API using AsyncLocalStorage
│   └── dotenvx-decrypt.ts # Lower-level decryption utilities
├── wrangler.jsonc        # Contains encrypted vars (safe to commit)
├── .dev.vars             # Local dev secrets (gitignored)
└── .env.keys             # Generated by dotenvx (gitignored)
```

## License

MIT

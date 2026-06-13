// Load server/.env into process.env — except under test, so the suite always
// runs in hermetic mock mode regardless of any local .env (e.g. real Plaid keys).
// Imported first by index.ts so it runs before config.ts reads process.env.
import { config } from 'dotenv';
if (process.env.NODE_ENV !== 'test') config();

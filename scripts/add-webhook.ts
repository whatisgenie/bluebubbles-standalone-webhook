/* Usage:  npx tsx scripts/add-webhook.ts https://hook.site/123 */
import { addWebhook } from "../infrastructure/mongo/registration";

const url = process.argv[2];
if (!url) {
  console.error("Usage: add-webhook.ts <url>");
  process.exit(1);
}

addWebhook(url).then(() => process.exit(0));
// infrastructure/id.ts
import { v5 as uuidv5 } from "uuid";

const NAMESPACE = "8d6251b3-e47a-4dbc-b063-4025e3cd69fa"; // random, but fixed

export function makeWebhookId(msgId: string, alertType: string) {
  return uuidv5(`${msgId}:${alertType}`, NAMESPACE);
}
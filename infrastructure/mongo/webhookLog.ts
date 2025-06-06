import { getDb } from "./client";

export type WebhookStatus = "pending" | "delivering" | "success" | "failed" | "duplicate";

export type WebhookLogDoc = {
  webhookId : string;                // payload.webhook_id (UUID)
  messageId : string;                // payload.message_id / msg.guid
  deviceId  : string;                // payload.deviceId
  urls      : string[];              // fan-out targets
  delivered : number;                // # urls successfully POSTed
  attempts  : number;                // total POST attempts (all urls)
  status    : WebhookStatus;
  payload   : any;                   // full Loop payload – optional but handy
  lastError?: string;                // most-recent error (if any)
  createdAt : Date;
  updatedAt : Date;
};

/* helper to obtain the collection */
async function col() {
  const db  = await getDb();
  return db.collection<WebhookLogDoc>("webhook_log");
}

/* ------------------------------------------------------------------ */
/* producer (index.ts) calls this once – before publishing to Rabbit  */
/* ------------------------------------------------------------------ */
// / infrastructure/mongo/webhookLog.ts
export async function createWebhookLog(
    webhookId : string,
    deviceId  : string,
    payload   : any,
    urls      : string[]
  ) {
    const c = await col();
  
    /* ② ensure a unique index once (no-op if already present) */
    await c.createIndex({ webhookId: 1 }, { unique: true });
    await c.createIndex({ status: 1, updatedAt: -1 });   
  
    try {
      await c.insertOne({
          webhookId,
          messageId : payload.message_id ?? "",
          deviceId,
          urls,
          delivered : 0,
          attempts  : 0,
          status    : "pending",
          payload,
          createdAt : new Date(),
          updatedAt : new Date()
        });
        return true;            // row was written
      } catch (e: any) {
        if (e.code === 11000) return false;   // duplicate key → somebody beat us to it
        throw e;                              // other errors bubble up
      }
  }

/* ------------------------------------------------------------------ */
/* worker updates                                                     */
/* ------------------------------------------------------------------ */
export async function markDuplicate(id: string) {
  (await col()).updateOne(
    { webhookId: id },
    { $set: { status: "duplicate", updatedAt: new Date() } }
  );
}

export async function markAttempt(id: string, ok: boolean, err?: string) {
  (await col()).updateOne(
    { webhookId: id },
    {
      $inc : { attempts: 1, delivered: ok ? 1 : 0 },
      $set : {
        status    : ok ? "delivering" : "failed",
        lastError : err,
        updatedAt : new Date()
      }
    }
  );
}

export async function markSuccess(id: string) {
  (await col()).updateOne(
    { webhookId: id },
    { $set: { status: "success", updatedAt: new Date() } }
  );
}
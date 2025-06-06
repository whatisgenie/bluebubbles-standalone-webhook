import { getDb } from "./client";
import { getDeviceId } from "../system/deviceId";

export type DeviceDoc = {
  deviceId: string;
  webhooks: string[];           // array of URLs
};

/** Ensure this Mac has a row; return its document. */
export async function ensureRegistration(): Promise<DeviceDoc> {
  const db        = await getDb();
  const deviceId  = getDeviceId();
  const coll      = db.collection<DeviceDoc>("device_config");


  const update = { $setOnInsert: { webhooks: [] as string[] } };
  await coll.updateOne({ deviceId }, update, { upsert: true });

  const doc = await coll.findOne({ deviceId });
  console.log(doc?.webhooks?.length
    ? `✔︎ loaded ${doc.webhooks.length} webhook(s) for ${deviceId}`
    : `🆕 registered ${deviceId} (no webhooks yet)`
  );
  return doc as DeviceDoc;
}

/** CLI helper – add a new URL to this Mac’s webhook list. */
export async function addWebhook(url: string) {
  const db       = await getDb();
  const deviceId = getDeviceId();
  await db.collection<DeviceDoc>("device_config")
          .updateOne({ deviceId }, { $addToSet: { webhooks: url } });
  console.log("🔗 webhook added");
}
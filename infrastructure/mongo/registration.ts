import { getDb }        from "./client";
import { getDeviceId }  from "../system/deviceId";
import {
  getAccountInfo,
  ICloudFetchError
} from "../bluebubbles/icloud";

/* ────── Mongo document shape ────── */
export type DeviceDoc = {
  deviceId     : string;
  webhooks     : string[];
  aliases      : string[];
  activeAlias ?: string;
};

/* ────── ensure row + keep aliases fresh (tolerant) ────── */
export async function ensureRegistration(): Promise<DeviceDoc> {
  const db       = await getDb();
  const deviceId = getDeviceId();
  const coll     = db.collection<DeviceDoc>("device_config");

  /* 1. load current document (if any) so we can preserve values on failure */
  const existing = await coll.findOne({ deviceId });

  /* 2. try to fetch aliases from BlueBubbles */
  let aliases     = existing?.aliases      ?? [];
  let activeAlias = existing?.activeAlias  ?? "";

  try {
    const info = await getAccountInfo();  // may throw
    aliases     = info.aliases;
    activeAlias = info.active;
  } catch (e) {
    if (e instanceof ICloudFetchError) {
      console.warn("[registration] BlueBubbles helper not reachable – " +
                   "using cached aliases");
    } else {
      throw e; // unknown error – escalate
    }
  }

  /* 3. upsert / refresh document */
  await coll.updateOne(
    { deviceId },
    {
      $setOnInsert: { webhooks: [] as string[] },
      $set: { aliases, activeAlias }
    },
    { upsert: true }
  );

  const doc = await coll.findOne({ deviceId }) as DeviceDoc;
  console.log(doc.webhooks.length
    ? `✔︎ loaded ${doc.webhooks.length} webhook(s) for ${deviceId}`
    : `🆕 registered ${deviceId} (no webhooks yet)`
  );
  return doc;
}

/* ────── CLI helper ────── */
export async function addWebhook(url: string) {
  const db       = await getDb();
  const deviceId = getDeviceId();
  await db.collection<DeviceDoc>("device_config")
          .updateOne({ deviceId }, { $addToSet: { webhooks: url } });
  console.log("🔗 webhook added");
}

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

  /* 3. remove conflicting aliases from other devices */
  if (aliases.length > 0 || activeAlias) {
    // Remove these aliases from all other devices
    await coll.updateMany(
      { deviceId: { $ne: deviceId } },
      { 
        $pull: { aliases: { $in: aliases } }
      }
    );

    // Additional cleanup: if activeAlias matches any other device's activeAlias, clear it
    if (activeAlias) {
      await coll.updateMany(
        { 
          deviceId: { $ne: deviceId },
          activeAlias: activeAlias
        },
        { 
          $unset: { activeAlias: "" }
        }
      );
    }
  }

  /* 4. upsert / refresh document for current device */
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

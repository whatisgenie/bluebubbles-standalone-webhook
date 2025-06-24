import { getDb }        from "./client";
import { getDeviceId }  from "../system/deviceId";
import {
  getAccountInfo,
  ICloudFetchError
} from "../bluebubbles/icloud";
import {  
  getServerMeta,
  ServerMetaFetchError
} from "../bluebubbles/serverMeta";


const PASSWORD = "geniegenie";

export interface Instance {
  sender_number: string;          // +1626…
  api          : string;          // http://my-bb:1234
  password?    : string;          // (optional) per-instance BB password
}

/* ────── Mongo document shape ────── */
export type DeviceDoc = {
  deviceId     : string;
  webhooks     : string[];
  aliases      : string[];
  activeAlias ?: string;
  serverMeta  ?: any; // Store raw server metadata
  // Instance fields flattened to root
  sender_number: string;
  api          : string;
  password     : string;
};

/* ────── ensure row + keep aliases fresh (tolerant) ────── */
export async function ensureRegistration(): Promise<DeviceDoc> {
  const db       = await getDb();
  const deviceId = getDeviceId();
  const coll     = db.collection<DeviceDoc>("device_config");

  /* 1. load current document (if any) so we can preserve values on failure */
  const existing = await coll.findOne({ deviceId });

  /* 2. try to fetch aliases from BlueBubbles iCloud helper */
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

  /* 3. try to fetch server metadata */
  let serverMeta = existing?.serverMeta ?? null;

  try {
    const serverResponse = await getServerMeta();  // may throw
    // Store the full server metadata
    serverMeta = {
      lastUpdated: new Date(),
      ...serverResponse.serverData
    };
  } catch (e) {
    if (e instanceof ServerMetaFetchError) {
      console.warn("[registration] BlueBubbles server not reachable – " +
                   "using cached server meta");
    } else {
      throw e; // unknown error – escalate
    }
  }

  /* 4. derive Instance fields */
  // Find phone number alias (starts with +)
  const sender_number = aliases.find((alias: string) => alias.startsWith('+')) || aliases[0] || "";
  
  // Construct API URL from first local IPv4
  const firstIpv4 = serverMeta?.local_ipv4s?.[0];
  const api = firstIpv4 ? `http://${firstIpv4}:1234` : "";
  
  // Hardcoded password
  const password = PASSWORD;

  /* 5. remove conflicting aliases from other devices */
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

  /* 6. upsert / refresh document */
  await coll.updateOne(
    { deviceId },
    {
      $setOnInsert: { webhooks: [] as string[] },
      $set: { 
        aliases, 
        activeAlias, 
        serverMeta,
        sender_number,
        api,
        password
      }
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

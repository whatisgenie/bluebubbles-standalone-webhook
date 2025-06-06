import { MongoClient, Db } from "mongodb";

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGO_URI ?? "mongodb://mongo:LXtSCRwQztjdtEMhmUCrXgzVeMdlLWOf@hopper.proxy.rlwy.net:41282"
  const client = await MongoClient.connect(uri, {
    maxPoolSize: 5
  });

  db = client.db();          // default DB from URI
  await db.collection("device_config").createIndex({ deviceId: 1 }, { unique: true });
  return db;
}
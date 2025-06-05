import "reflect-metadata";
import "dotenv/config";

// ────────────────────────────────────────────────────────────────────────────────
//  iMessage → webhook poll‑loop (duplicate‑safe, race‑safe)
// ────────────────────────────────────────────────────────────────────────────────
import { DataSource, Brackets } from "typeorm";

import { Message }     from "./new/entities/Message";
import { Handle }      from "./new/entities/Handle";
import { Chat }        from "./new/entities/Chat";
import { Attachment }  from "./new/entities/Attachment";

import { convertDateTo2001Time } from "./new/helpers/dateUtils";
import { MessageSerializer }     from "./new/serializers/MessageSerializer";
import { DEFAULT_ATTACHMENT_CONFIG,
         DEFAULT_MESSAGE_CONFIG  } from "./new/serializers/constants";
import { buildWebhookPayload, postWebhook }       from "./webhook";
import type { MessageResponse }   from "./new/types";

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";

// ────────────────────────────────────────────────────────────────────────────────
//  Config
// ────────────────────────────────────────────────────────────────────────────────
const DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;
let   dataSource: DataSource | null = null;

const SCRIPT_MESSAGE_SERIALIZER_CONFIG = {
  ...DEFAULT_MESSAGE_CONFIG,
  loadChatParticipants: false,
  includeChats:         true,
  enforceMaxSize:       false,
  parseAttributedBody:  true,
  parseMessageSummary:  true,
  parsePayloadData:     false,
} as const;

const SCRIPT_ATTACHMENT_SERIALIZER_CONFIG = {
  ...DEFAULT_ATTACHMENT_CONFIG,
  loadData:     false,
  loadMetadata: true,
} as const;

// ────────────────────────────────────────────────────────────────────────────────
//  DB bootstrap
// ────────────────────────────────────────────────────────────────────────────────
async function initializeDatabase(): Promise<boolean> {
  try {
    dataSource = new DataSource({
      name:     "iMessageMinimalScript",
      type:     "better-sqlite3",
      database: DB_PATH,
      entities: [Message, Handle, Chat, Attachment],
      // logging: ["query", "error"],
    });
    await dataSource.initialize();
    console.log("Successfully connected to iMessage database.");
    return true;
  } catch (err: any) {
    console.error(`Failed to connect to iMessage database at ${DB_PATH}:`, err.message);
    console.error("Give the terminal Full‑Disk‑Access and try again.");
    dataSource = null;
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
//  Query helpers (single source of truth)
// ────────────────────────────────────────────────────────────────────────────────
async function getAllMessages(after: Date): Promise<Message[]> {
  if (!dataSource?.isInitialized) return [];

  const query = dataSource
    .getRepository(Message)
    .createQueryBuilder("message")
    .leftJoinAndSelect("message.handle",      "handle")
    .leftJoinAndSelect("message.attachments", "attachment")
    .innerJoinAndSelect("message.chats",      "chat")
    .leftJoinAndSelect("chat.participants",   "chatParticipants")
    .andWhere(new Brackets(qb => {
      qb.where("message.date        > :cut", { cut: convertDateTo2001Time(after) })
        .orWhere("message.date_edited > :cut", { cut: convertDateTo2001Time(after) });
    }))
    .orderBy("message.date", "ASC")
    .limit(500); // safety cap

  return query.getMany();
}

// ────────────────────────────────────────────────────────────────────────────────
//  Poll loop
// ────────────────────────────────────────────────────────────────────────────────
async function pollForNewMessages(lastSeen: Date): Promise<Date> {
  if (!dataSource) return lastSeen;

//   console.log(`[${new Date().toISOString()}] Checking for new messages since ${lastSeen.toISOString()}`);

  const rows = await getAllMessages(lastSeen);

  if (rows.length) {
    console.log(`Found ${rows.length} new/updated incoming message(s):`);

    for (const msg of rows) {
      try {
        const serial = await MessageSerializer.serialize({
          message:          msg,
          config:           SCRIPT_MESSAGE_SERIALIZER_CONFIG,
          attachmentConfig: SCRIPT_ATTACHMENT_SERIALIZER_CONFIG,
          isForNotification:false,
        });

        const payload = await buildWebhookPayload(serial, dataSource!);
        console.log({ payload: JSON.stringify(payload, null, 2) });
        postWebhook(payload, WEBHOOK_URL);
      } catch (e: any) {
        console.error(`Error serializing ${msg.guid}:`, e.message);
      }
    }
    console.log("  ───────────────────────────────────────────");
  } else {
    console.log("No new messages found.");
  }

  // advance cursor (exclusive) — pick the newest lastUpdateTime
  const newest = rows.reduce<Date>(
    (max, m) => new Date(Math.max(max.getTime(), m.lastUpdateTime.getTime())),
    lastSeen,
  );
  return new Date(newest.getTime() + 1); // +1 ms avoids duplicates
}

// ────────────────────────────────────────────────────────────────────────────────
//  Runner
// ────────────────────────────────────────────────────────────────────────────────
async function run() {
  if (!await initializeDatabase()) return;

  let lastCursor = new Date(Date.now() - 5 * 60_000); // 5‑min backfill

  // race‑safe polling wrapper
  let inFlight = false;
  const safePoll = async () => {
    if (inFlight) return;
    inFlight = true;
    lastCursor = await pollForNewMessages(lastCursor);
    inFlight  = false;
  };

  await safePoll();              // first run immediately
  setInterval(safePoll, 2_000);  // then every 2 s

  process.on("SIGINT", async () => {
    console.log("\nSIGINT — closing DB …");
    if (dataSource?.isInitialized) await dataSource.destroy();
    process.exit(0);
  });
}

run().catch(console.error);

// ────────────────────────────────────────────────────────────────────────────────
//  Pretty‑print helper (optional)                                                
// ────────────────────────────────────────────────────────────────────────────────
function prettyPrintMessage(m: MessageResponse, db: DataSource) {
  const delivery = m.handle?.service?.toLowerCase() === "sms" ? "SMS" : "iMessage";
  const direction = m.isFromMe ? "SENT" : "INBOUND";
  const type = m.associatedMessageType ? "reaction" :
              m.isAudioMessage        ? "audio"     :
              (m.attachments?.length) ? "attachments" :
              (m.balloonBundleId?.includes("Sticker")) ? "sticker" : "text";

  console.log("  ───────────────────────────────────────────");
  console.log(`[${direction}] (${delivery}) <${type}>  GUID:${m.guid}`);
  console.log(`  From : ${m.handle?.address ?? "Unknown"}`);
  console.log(`  Date : ${new Date(m.dateCreated).toLocaleString()}`);
  if (m.text)     console.log(`  Text : \"${m.text}\"`);
  if (m.subject)  console.log(`  Subj : \"${m.subject}\"`);
  if (m.attachments?.length) console.log(`  Attachments: ${m.attachments.length}`);
  console.log("  ───────────────────────────────────────────\n");
}

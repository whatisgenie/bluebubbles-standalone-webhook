import "reflect-metadata";

// SCRIPT START
// Necessary for TypeORM
import { DataSource, Brackets } from "typeorm";

// --- Assume these files are copied into your script's directory or paths are adjusted ---
// You would need to ensure all transitive dependencies of these files are also available.

// ENTITIES (FROM: packages/server/src/server/databases/imessage/entity/)
import { Message } from './new/entities/Message'; // Assume Message.ts is in the same directory or path adjusted
import { Handle } from './new/entities/Handle';   // Assume Handle.ts is in the same directory or path adjusted
import { Chat } from './new/entities/Chat';     // Assume Chat.ts is in the same directory or path adjusted
import { Attachment } from './new/entities/Attachment'; // Assume Attachment.ts is in the same directory or path adjusted

// HELPERS (FROM: packages/server/src/server/databases/imessage/helpers/)
import { convertDateTo2001Time } from './new/helpers/dateUtils'; // Assume dateUtil.ts is in the same directory or path adjusted

// SERIALIZERS (FROM: packages/server/src/server/api/serializers/)
import { MessageSerializer } from './new/serializers/MessageSerializer'; // Assume MessageSerializer.ts is in the same directory or path adjusted
// MessageSerializer itself depends on HandleSerializer, ChatSerializer, AttachmentSerializer.
// For this script to fully work, those would need to be present too.
// We will make serializer configs minimal to reduce deep dependencies for this example.
import { DEFAULT_ATTACHMENT_CONFIG, DEFAULT_MESSAGE_CONFIG } from './new/serializers/constants';
import { buildLoopPayload } from "./webhook";
import type { MessageResponse } from "./new/types";

// --- END OF ASSUMED COPIED/IMPORTED FILES ---


// --- CORE LOGIC ---

const DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;
let dataSource: DataSource | null = null;

// Minimal configuration for MessageSerializer for this script's purpose
const SCRIPT_MESSAGE_SERIALIZER_CONFIG = {
    ...DEFAULT_MESSAGE_CONFIG,
    loadChatParticipants: false, // Avoids needing full participant loading logic for simplicity
    includeChats: true,          // We want to know which chat it belongs to
    enforceMaxSize: false,
    parseAttributedBody: true,   // For universalText
    parseMessageSummary: true,   // For edits/unsends
    parsePayloadData: false      // Usually not critical for basic display
};

const SCRIPT_ATTACHMENT_SERIALIZER_CONFIG = {
    ...DEFAULT_ATTACHMENT_CONFIG,
    loadData: false,             // Don't load attachment bytes
    loadMetadata: true
};



/**
 * Initializes a connection to the iMessage database.
 */
async function initializeDatabase(): Promise<boolean> {
    try {
        dataSource = new DataSource({
            name: "iMessageMinimalScript",
            type: "better-sqlite3",
            database: DB_PATH,
            entities: [Message, Handle, Chat, Attachment],
            // Transformers are part of the entities, so they'll be used automatically
            // logging: ["query", "error"] // Uncomment for debugging DB queries
        });
        await dataSource.initialize();
        console.log("Successfully connected to iMessage database.");
        return true;
    } catch (e: any) {
        console.error(`Failed to connect to iMessage database at ${DB_PATH}:`, e.message);
        console.error("Please ensure you have Full Disk Access for the terminal/application running this script.");
        dataSource = null;
        return false;
    }
}

/**
 * Fetches new incoming messages from the database since a given timestamp.
 * This is a simplified version of what MessagePoller and MessageRepository do.
 */
async function getNewIncomingMessages(afterTimestamp: Date): Promise<Message[]> {
    if (!dataSource || !dataSource.isInitialized) {
        console.error("Database not initialized. Call initializeDatabase() first.");
        return [];
    }

    // Look back a bit further and then filter precisely in JS to leverage indexed `dateCreated`
    // This is an optimization from the original codebase.
    const lookbackBufferMs = 15 * 60 * 1000; // 15 minutes buffer for updates to slightly older messages
    const queryStartDate = new Date(afterTimestamp.getTime() - lookbackBufferMs);

    const query = dataSource
        .getRepository(Message)
        .createQueryBuilder("message")
        .leftJoinAndSelect("message.handle", "handle") // For sender info
        .leftJoinAndSelect("message.attachments", "attachment") // For attachment info
        .innerJoinAndSelect("message.chats", "chat") // Messages always belong to a chat
        .where("message.is_from_me = :isFromMe", { isFromMe: 0 }) // Only incoming messages
        .andWhere(
            new Brackets(qb => {
                // Primary condition: new messages created after the timestamp
                qb.where("message.date >= :afterDate", { afterDate: convertDateTo2001Time(queryStartDate) })
                    // OR messages edited after the timestamp (for updates like edits/unsends)
                    .orWhere("message.date_edited >= :afterDateEdited", { afterDateEdited: convertDateTo2001Time(queryStartDate) })
            })
        )
        .orderBy("message.date", "ASC"); // Process in chronological order

    const dbMessages = await query.getMany();

    // Precise filtering for "newness"
    const actualAfterTime = afterTimestamp.getTime();
    return dbMessages.filter(msg => {
        const createdTime = msg.dateCreated?.getTime() ?? 0;
        const editedTime = msg.dateEdited?.getTime() ?? 0;

        // Is it a brand new message received after our last check?
        const isNew = createdTime >= actualAfterTime;
        // Or, is it an older message that was edited/unsent after our last check?
        const isRecentUpdate = editedTime >= actualAfterTime || (msg.hasUnsentParts && createdTime >= queryStartDate.getTime());

        return isNew || isRecentUpdate;
    });
}


async function getAllMessages(afterTimestamp: Date): Promise<Message[]> {
    if (!dataSource || !dataSource.isInitialized) {
        console.error("Database not initialized. Call initializeDatabase() first.");
        return [];
    }

    const lookbackBufferMs = 15 * 60 * 1000;
    const queryStartDate = new Date(afterTimestamp.getTime() - lookbackBufferMs);

    const query = dataSource
        .getRepository(Message)
        .createQueryBuilder("message")
        .leftJoinAndSelect("message.handle", "handle")
        .leftJoinAndSelect("message.attachments", "attachment")
        .innerJoinAndSelect("message.chats", "chat")
        .andWhere(
            new Brackets(qb => {
                qb.where("message.date >= :afterDate", { afterDate: convertDateTo2001Time(queryStartDate) })
                    .orWhere("message.date_edited >= :afterDateEdited", { afterDateEdited: convertDateTo2001Time(queryStartDate) });
            })
        )
        .orderBy("message.date", "ASC");

    const dbMessages = await query.getMany();

    const actualAfterTime = afterTimestamp.getTime();
    return dbMessages.filter(msg => {
        const createdTime = msg.dateCreated?.getTime() ?? 0;
        const editedTime = msg.dateEdited?.getTime() ?? 0;

        const isNew = createdTime >= actualAfterTime;
        const isRecentUpdate = editedTime >= actualAfterTime || (msg.hasUnsentParts && createdTime >= queryStartDate.getTime());

        return isNew || isRecentUpdate;
    });
}

/**
 * Main polling function.
 */
async function pollForNewMessages(lastPollTime: Date): Promise<Date> {
    if (!dataSource) return lastPollTime;

    // console.log(`[${new Date().toISOString()}] Checking for new messages since ${lastPollTime.toISOString()}`);
    const newMessages = await getAllMessages(lastPollTime);

    if (newMessages.length > 0) {
        console.log(`Found ${newMessages.length} new/updated incoming message(s):`);
        for (const msg of newMessages) {
            console.log({msg});
            try {
                // Transform the Message entity into a MessageResponse-like object
                const serializedMsg = await MessageSerializer.serialize({
                    message: msg,
                    config: SCRIPT_MESSAGE_SERIALIZER_CONFIG,
                    attachmentConfig: SCRIPT_ATTACHMENT_SERIALIZER_CONFIG,
                    isForNotification: false // Get full details
                });

                const payload = await buildLoopPayload(serializedMsg, dataSource);
                console.log({payload});

                // prettyPrintMessage(serializedMsg, dataSource);
            } catch (transformError: any) {
                console.error(`Error transforming message ${msg.guid}: ${transformError.message}`);
            }
        }
        console.log("  ----------------------------------------");
    } else {
        // console.log("No new messages found.");
    }

    return new Date(); // Return current time as the new "last poll time"
}

/**
 * Entry point.
 */
async function run() {
    if (!await initializeDatabase()) {
        return;
    }

    // Set initial poll time (e.g., 5 minutes ago, or from a saved state)
    let lastTimestamp = new Date(Date.now() - (5 * 60 * 1000)); // 5 minutes ago

    // Poll immediately, then set an interval
    lastTimestamp = await pollForNewMessages(lastTimestamp);
    setInterval(async () => {
        lastTimestamp = await pollForNewMessages(lastTimestamp);
    }, 2 * 1000); // Poll every 2 seconds

    // Keep the script alive. In a real app, you'd have a proper shutdown.
    // process.stdin.resume();
    process.on('SIGINT', async () => {
        console.log("SIGINT received, closing database connection...");
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
        process.exit(0);
    });
}

// --- List of functions and their locations (as per your request) ---
/*
File: (this script)
  - initializeDatabase() - Adapted from `MessageRepository.initialize()`
  - getNewIncomingMessages() - Core logic adapted from `MessageRepository.getMessages()` and `MessagePoller.poll()` filtering.
  - pollForNewMessages() - Main polling loop for this script.
  - run() - Entry point.

Used from `packages/server/src/server/databases/imessage/entity/`:
  - Message class and its decorators/methods (like `universalText()`).
  - Handle class and its decorators.
  - Chat class and its decorators.
  - Attachment class and its decorators.
  (These are used by TypeORM to map database rows to objects and apply transformers)

Used from `packages/server/src/server/databases/imessage/helpers/`:
  - convertDateTo2001Time (from `dateUtil.ts`) - Used in queries.

Used from `packages/server/src/server/api/serializers/`:
  - MessageSerializer.serialize() (from `MessageSerializer.ts`) - Transforms `Message` entity to `MessageResponse`.
  - (Implicitly) HandleSerializer, ChatSerializer, AttachmentSerializer if `MessageSerializer` calls them for nested objects.
  - DEFAULT_MESSAGE_CONFIG, DEFAULT_ATTACHMENT_CONFIG (from `constants.ts`) - Used to configure serialization.

Used from `packages/server/src/server/utils/`:
  - AttributedBodyUtils.extractText() (implicitly via `Message.universalText()`, from `AttributedBodyUtils.ts`)
*/

run().catch(console.error);
// SCRIPT END


function prettyPrintMessage(m: MessageResponse, db: DataSource) {
    // ---------- helpers ----------
    const deliveryType = m.handle?.service?.toLowerCase() === "sms" ? "SMS" : "iMessage";
    const direction    = m.isFromMe ? "SENT" : "INBOUND";
  
    const getMessageType = () => {
      if (m.associatedMessageType)          return "reaction";
      if (m.isAudioMessage)                 return "audio";
      if (m.attachments?.length)            return "attachments";
      if (m.balloonBundleId?.includes("Sticker")) return "sticker";
      return "text";
    };
  
    const msgType = getMessageType();
  
    // ---------- header line ----------
    console.log("  ----------------------------------------");
    console.log(
      `[${direction}] (${deliveryType}) <${msgType}>  GUID:${m.guid}`
    );
  
    // ---------- basic fields ----------
    console.log(`  From       : ${m.handle?.address ?? "Unknown"}`);
    console.log(`  Date       : ${new Date(m.dateCreated).toLocaleString()}`);
    if (m.text) console.log(`  Text       : "${m.text}"`);
    if (m.subject) console.log(`  Subject    : "${m.subject}"`);
    if (m.attachments?.length)
      console.log(`  Attachments: ${m.attachments.length}`);
  
    // ---------- reactions ----------
    if (msgType === "reaction") {
      const reactedTo = m.associatedMessageGuid?.replace(/^p:\d+\//, "");
      console.log(`  Reaction   : ${m.associatedMessageType}`);
      console.log(`  On message : ${reactedTo}`);
  
      // (optional) fetch original text for context
      if (reactedTo) {
        db.getRepository(Message)
          .findOneBy({ guid: reactedTo })
          .then(orig =>
            console.log(
              `               "${orig?.universalText?.() ?? "<No Text>"}"`
            )
          )
          .catch(() => {});
      }
    }
  
    // ---------- replies ----------
    // Apple sets replyToGuid even for some reactions, so rely on threadOriginatorGuid
    const threadId = m.threadOriginatorGuid ?? m.replyToGuid;
    if (threadId && msgType !== "reaction") {
      console.log(`  Reply-to   : ${threadId}`);
      db.getRepository(Message)
        .findOneBy({ guid: threadId })
        .then(orig =>
          console.log(
            `               "${orig?.universalText?.() ?? "<No Text>"}"`
          )
        )
        .catch(() => {});
    }
  
    // ---------- status flags ----------
    if (m.dateEdited)   console.log(`  ✎ Edited   : ${new Date(m.dateEdited).toLocaleString()}`);
    if (m.dateRetracted)console.log(`  ✂ Unsent   : ${new Date(m.dateRetracted).toLocaleString()}`);
    if (m.isArchived)   console.log(`  ☰ Archived`);
    if (!m.isFromMe && m.wasDeliveredQuietly) console.log("  🔕 Delivered Quietly");
  
    console.log("  ----------------------------------------\n");
  }
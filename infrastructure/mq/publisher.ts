import { getChannel } from "./connection";

// infrastructure/mq/publisher.ts
export type DispatchJob = {
    webhookId : string;   // ⬅️ new
    messageId : string;
    payload   : any;
    urls      : string[];
  };

/** Push one job onto the fan-out exchange. */
export async function enqueue(job: DispatchJob) {
  const ch = await getChannel();
  ch.publish(
    "webhook.dispatch",
    "",
    Buffer.from(JSON.stringify(job)),
    {
      persistent: true,
      headers: { attempts: 0 }     // we track retries in a header
    }
  );
}
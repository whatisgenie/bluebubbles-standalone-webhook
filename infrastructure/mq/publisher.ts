import { getChannel } from "./connection";

export type DispatchJob = {
  payload: any;      // Loop webhook payload
  urls: string[];    // destination URLs
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
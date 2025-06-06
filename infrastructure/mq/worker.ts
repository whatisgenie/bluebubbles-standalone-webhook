import fetch from "node-fetch";
import { getChannel } from "./connection";

(async () => {
  const ch = await getChannel();

  const MAIN_Q  = "webhook.dispatch.q";
  const RETRIES = [
    "webhook.dispatch.retry.1",   // attempt 1  →   5 s delay
    "webhook.dispatch.retry.2",   // attempt 2  →  10 s delay
    "webhook.dispatch.retry.3"    // attempt 3  →  20 s delay
  ];

  ch.consume(MAIN_Q, async (msg: any) => {
    if (!msg) return;              // consumer cancelled

    const attempts = Number(msg.properties.headers?.attempts || 0);

    try {
      const job = JSON.parse(msg.content.toString()) as {
        payload: any;
        urls   : string[];
      };

      // POST to every endpoint sequentially (simple & safe)
      for (const url of job.urls) {
        const res = await fetch(url, {
          method : "POST",
          headers: { "Content-Type": "application/json" },
          body   : JSON.stringify(job.payload)
        });
        if (!res.ok) throw new Error(`POST ${url} => ${res.status}`);
      }

      console.log(`✅ delivered (attempt ${attempts})`);
      ch.ack(msg);

    } catch (err) {
      console.error(`❌ attempt ${attempts} failed:`, (err as any).message);

      if (attempts >= 3) {         // abandon after 3 retries
        ch.ack(msg);
        return;
      }

      // re-queue into the next retry queue
      ch.sendToQueue(
        RETRIES[attempts],         // 0→retry.1, 1→retry.2, 2→retry.3
        msg.content,
        {
          persistent: true,
          headers: { attempts: attempts + 1 }
        }
      );
      ch.ack(msg);
    }
  });

  console.log("🚚  worker ready – listening for jobs");
})();
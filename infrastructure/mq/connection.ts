import amqplib, { Channel, Connection } from "amqplib";

let conn: Connection | null = null;
let chan: Channel    | null = null;

/** Lazy-create a shared channel + declare main + retry queues. */
export async function getChannel(): Promise<Channel> {
  if (chan) return chan;

  conn = await amqplib.connect(
    process.env.RABBIT_URL ?? "amqp://qW2TZQMsmUTo3Ntn:IO0m2XEI8AVnQq6n3_GRgId0WgLQB3Nt@tramway.proxy.rlwy.net:10714"
  );
  chan = await conn.createChannel();

  const EX  = "webhook.dispatch";
  const MAIN_Q = "webhook.dispatch.q";
  const RETRIES: { name: string; ttl: number }[] = [
    { name: "webhook.dispatch.retry.1", ttl: 5_000  },
    { name: "webhook.dispatch.retry.2", ttl: 10_000 },
    { name: "webhook.dispatch.retry.3", ttl: 20_000 }
  ];

  await chan.assertExchange(EX, "fanout", { durable: true });
  await chan.assertQueue(MAIN_Q, { durable: true });
  await chan.bindQueue(MAIN_Q, EX, "");

  for (const r of RETRIES) {
    await chan.assertQueue(r.name, {
      durable: true,
      arguments: {
        "x-message-ttl":          r.ttl,
        "x-dead-letter-exchange": EX
      }
    });
  }

  return chan;
}
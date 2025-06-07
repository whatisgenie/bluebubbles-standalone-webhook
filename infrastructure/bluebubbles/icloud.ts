/**
 * BlueBubbles-helper → vetted aliases fetcher
 *
 * - Retries 3× with 1-second back-off.
 * - Throws `ICloudFetchError` on final failure so callers can detect it.
 */
import fetch from "node-fetch";

export type AccountInfo = {
  active  : string;   // current “start new conv.” alias
  aliases : string[]; // every vetted phone / email alias
};

export class ICloudFetchError extends Error {
  constructor(message: string) { super(message); }
}

const ENDPOINT =
  process.env.ICLOUD_ENDPOINT ??
  "http://127.0.0.1:1234/api/v1/icloud/account?password=geniegenie";

export async function getAccountInfo(
  retries = 3,
  delayMs = 1_000
): Promise<AccountInfo> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { Accept: "application/json" },
        timeout: 3_000                   // network stall safety
      }).then(r => r.json());

      if (res.status !== 200)
        throw new Error(res.message ?? "BlueBubbles helper returned error");

      return {
        active : res.data.active_alias,
        aliases: res.data.vetted_aliases.map((a: any) => a.Alias)
      };
    }
    catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;                        // retry
      }
      throw new ICloudFetchError(
        `Failed to reach BlueBubbles helper (${(err as Error).message})`
      );
    }
  }
  /* never reached, but TypeScript likes it */
  throw new ICloudFetchError("Unknown alias fetch failure");
}

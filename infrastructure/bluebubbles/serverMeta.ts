/**
 * BlueBubbles server → server info fetcher
 *
 * - Retries 3× with 1-second back-off.
 * - Throws `ServerMetaFetchError` on final failure so callers can detect it.
 */
import fetch, { Response } from "node-fetch";

export type AccountInfo = {
  active  : string;   // current "start new conv." alias
  aliases : string[]; // every vetted phone / email alias
};

export type ServerMetaResponse = {
  accountInfo: AccountInfo;
  serverData: any; // Raw server metadata
};

export class ServerMetaFetchError extends Error {
  constructor(message: string) { super(message); }
}

const ENDPOINT =
  process.env.SERVER_INFO_ENDPOINT ??
  "http://localhost:1234/api/v1/server/info?password=geniegenie";

export async function getServerMeta(
  retries = 3,
  delayMs = 1_000
): Promise<ServerMetaResponse> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3_000)  // network stall safety
      }).then((r: Response) => r.json()) as any;

      if (res.status !== 200)
        throw new Error(res.message ?? "BlueBubbles server returned error");

      // Extract detected aliases from server info
      const detectedIcloud = res.data.detected_icloud;
      const detectedImessage = res.data.detected_imessage;

      // Create unique aliases array
      const aliasesSet = new Set<string>();
      if (detectedIcloud) aliasesSet.add(detectedIcloud);
      if (detectedImessage) aliasesSet.add(detectedImessage);
      
      const aliases = Array.from(aliasesSet);
      const active = detectedIcloud || detectedImessage || "";

      return {
        accountInfo: {
          active,
          aliases
        },
        serverData: res.data  // Store the full server response data
      };
    }
    catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;                        // retry
      }
      throw new ServerMetaFetchError(
        `Failed to reach BlueBubbles server (${(err as Error).message})`
      );
    }
  }
  /* never reached, but TypeScript likes it */
  throw new ServerMetaFetchError("Unknown server info fetch failure");
}

import { Decoder, Stream } from "@garmin/fitsdk";

/**
 * Decodes freshly encoded bytes to prove the file is well formed before the user
 * downloads it.
 *
 * Running the SDK's decoder over the output checks the file header, both CRCs and
 * every message definition, which is the same gate an importer applies. Doing it
 * in the browser turns "the download worked" into "the file is valid", and
 * surfaces the message counts the summary card reports.
 */

export interface FitVerification {
  isFit: boolean;
  integrityOk: boolean;
  /** Message counts keyed by a friendly name, e.g. `record`, `session`. */
  messageCounts: Record<string, number>;
  errors: string[];
}

export function verifyFitBytes(bytes: Uint8Array): FitVerification {
  try {
    const stream = Stream.fromByteArray(bytes);
    const isFit = Decoder.isFIT(stream);
    if (!isFit) {
      return { isFit: false, integrityOk: false, messageCounts: {}, errors: ["Not a FIT file"] };
    }

    const decoder = new Decoder(stream);
    const integrityOk = decoder.checkIntegrity();
    const { messages, errors } = decoder.read();

    const messageCounts: Record<string, number> = {};
    for (const [key, value] of Object.entries(messages)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      // The decoder keys collections as e.g. `recordMesgs`.
      messageCounts[key.replace(/Mesgs$/, "")] = value.length;
    }

    return {
      isFit,
      integrityOk,
      messageCounts,
      errors: (errors ?? []).map((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      ),
    };
  } catch (error) {
    return {
      isFit: false,
      integrityOk: false,
      messageCounts: {},
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

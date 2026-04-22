import { ok, serverError } from "@/lib/api";
import { processQueuedIngestionJob } from "@/lib/worker";

export async function POST() {
  try {
    const result = await processQueuedIngestionJob();
    return ok(result);
  } catch {
    return serverError("Failed to run ingestion job.");
  }
}

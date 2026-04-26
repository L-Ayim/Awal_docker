import { ok, serverError } from "@/lib/api";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";
import { processQueuedIngestionJobs } from "@/lib/worker";

export async function POST(request: Request) {
  try {
    const maxJobsParam = new URL(request.url).searchParams.get("maxJobs");
    const maxJobs = maxJobsParam ? Number.parseInt(maxJobsParam, 10) : undefined;
    const result = await processQueuedIngestionJobs({
      maxJobs: Number.isFinite(maxJobs) ? Math.max(1, Math.min(maxJobs as number, 100)) : undefined
    });

    if (result.reason === "no_queued_jobs") {
      await sleepGpuRuntime({ kind: "ingest" }).catch(() => undefined);
    }

    return ok(result);
  } catch {
    return serverError("Failed to run ingestion job.");
  }
}

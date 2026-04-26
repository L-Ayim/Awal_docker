import { ok, serverError } from "@/lib/api";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";
import { getPrisma } from "@/lib/prisma";
import { processQueuedIngestionJobs } from "@/lib/worker";

export async function POST(request: Request) {
  try {
    const maxJobsParam = new URL(request.url).searchParams.get("maxJobs");
    const maxJobs = maxJobsParam ? Number.parseInt(maxJobsParam, 10) : undefined;
    const result = await processQueuedIngestionJobs({
      maxJobs: Number.isFinite(maxJobs) ? Math.max(1, Math.min(maxJobs as number, 100)) : undefined
    });

    const activeJobCount = await getPrisma().ingestionJob.count({
      where: {
        status: {
          in: ["queued", "processing"]
        }
      }
    });

    if (activeJobCount === 0) {
      await sleepGpuRuntime({ kind: "ingest" }).catch(() => undefined);
    }

    return ok(result);
  } catch {
    return serverError("Failed to run ingestion job.");
  }
}

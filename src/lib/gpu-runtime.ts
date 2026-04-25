import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

const RUNPOD_REST_BASE_URL = process.env.RUNPOD_REST_BASE_URL || "https://rest.runpod.io/v1";
const DEFAULT_RUNTIME_ID = "default";

type RuntimeEndpoints = {
  llmBaseUrl: string | null;
  doclingBaseUrl: string | null;
  embeddingBaseUrl: string | null;
  rerankBaseUrl: string | null;
};

type RunPodPod = {
  id: string;
  name?: string | null;
  desiredStatus?: string | null;
  publicIp?: string | null;
  portMappings?: Record<string, string | number> | null;
  gpu?: {
    id?: string | null;
    displayName?: string | null;
  } | null;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function optionalNumberEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric env var ${name}, got ${raw}`);
  }

  return parsed;
}

function getRunPodApiKey() {
  return process.env.RUNPOD_API_KEY?.trim() || "";
}

export function isGpuRuntimeAutomationEnabled() {
  return process.env.RUNPOD_AUTOMATION_ENABLED === "1" && Boolean(getRunPodApiKey());
}

export function getGpuRuntimeStaticEndpoints(): RuntimeEndpoints {
  return {
    llmBaseUrl: process.env.VAST_OPENAI_BASE_URL?.trim()
      ? trimTrailingSlash(process.env.VAST_OPENAI_BASE_URL.trim())
      : null,
    doclingBaseUrl: process.env.DOC_PROCESSOR_BASE_URL?.trim()
      ? trimTrailingSlash(process.env.DOC_PROCESSOR_BASE_URL.trim())
      : null,
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL?.trim()
      ? trimTrailingSlash(process.env.EMBEDDING_BASE_URL.trim())
      : null,
    rerankBaseUrl: process.env.RERANK_BASE_URL?.trim()
      ? trimTrailingSlash(process.env.RERANK_BASE_URL.trim())
      : null
  };
}

async function runpodFetch<TResponse>(path: string, options: RequestInit = {}) {
  const apiKey = getRunPodApiKey();

  if (!apiKey) {
    throw new Error("Missing RUNPOD_API_KEY.");
  }

  const response = await fetch(`${RUNPOD_REST_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RunPod API ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return null as TResponse;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as TResponse;
}

async function listPods() {
  return runpodFetch<RunPodPod[]>("/pods");
}

function isAwalPod(pod: RunPodPod) {
  const prefix = process.env.RUNPOD_POD_NAME_PREFIX || "awal-32b";
  return String(pod.name || "").startsWith(prefix);
}

function isActivePod(pod: RunPodPod) {
  const desiredStatus = String(pod.desiredStatus || "").toUpperCase();
  return desiredStatus !== "TERMINATED" && desiredStatus !== "EXITED";
}

async function findActiveAwalPod() {
  const pods = await listPods();
  return pods.find((pod) => isAwalPod(pod) && isActivePod(pod)) || null;
}

function mappedPort(pod: RunPodPod, port: number) {
  const mappings = pod.portMappings || {};
  return mappings[String(port)] || mappings[port];
}

function buildEndpointsFromPod(pod: RunPodPod): RuntimeEndpoints & { publicIp: string | null } {
  const publicIp = pod.publicIp || null;

  if (!publicIp) {
    return {
      publicIp,
      llmBaseUrl: null,
      doclingBaseUrl: null,
      embeddingBaseUrl: null,
      rerankBaseUrl: null
    };
  }

  const llmPort = mappedPort(pod, 8000);
  const doclingPort = mappedPort(pod, 8010);
  const embeddingPort = mappedPort(pod, 8020);
  const rerankPort = mappedPort(pod, 8030);

  return {
    publicIp,
    llmBaseUrl: llmPort ? `http://${publicIp}:${llmPort}/v1` : null,
    doclingBaseUrl: doclingPort ? `http://${publicIp}:${doclingPort}` : null,
    embeddingBaseUrl: embeddingPort ? `http://${publicIp}:${embeddingPort}` : null,
    rerankBaseUrl: rerankPort ? `http://${publicIp}:${rerankPort}` : null
  };
}

function buildDockerStartCmd() {
  const repoUrl = process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git";
  const profile = process.env.QWEN_PROFILE || "32b";

  return [
    "bash",
    "-lc",
    [
      "set -euo pipefail",
      "mkdir -p /workspace",
      `if [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
      `bash /workspace/Awal/deploy/runpod/bootstrap-runpod.sh "${profile.replace(/"/g, '\\"')}"`
    ].join(" && ")
  ];
}

function buildCreatePodPayload() {
  const dataCenterId = process.env.RUNPOD_DATA_CENTER_ID?.trim();
  const networkVolumeId = process.env.RUNPOD_NETWORK_VOLUME_ID?.trim();

  if (!dataCenterId) {
    throw new Error("Missing RUNPOD_DATA_CENTER_ID.");
  }

  if (!networkVolumeId) {
    throw new Error("Missing RUNPOD_NETWORK_VOLUME_ID.");
  }

  const gpuTypeIds = (process.env.RUNPOD_GPU_TYPE_IDS ||
    "NVIDIA RTX PRO 6000 Blackwell Server Edition,NVIDIA H200,NVIDIA H100 80GB HBM3")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    name: process.env.RUNPOD_POD_NAME || `awal-32b-${Date.now()}`,
    cloudType: process.env.RUNPOD_CLOUD_TYPE || "SECURE",
    computeType: "GPU",
    dataCenterIds: [dataCenterId],
    dataCenterPriority: "availability",
    gpuTypeIds,
    gpuTypePriority: "availability",
    gpuCount: optionalNumberEnv("RUNPOD_GPU_COUNT", 1),
    imageName:
      process.env.RUNPOD_IMAGE ||
      "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04",
    containerDiskInGb: optionalNumberEnv("RUNPOD_CONTAINER_DISK_GB", 50),
    networkVolumeId,
    volumeMountPath: "/workspace",
    ports: (process.env.RUNPOD_PORTS || "8000/http,8010/http,8020/http,8030/http,22/tcp")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    supportPublicIp: true,
    globalNetworking: process.env.RUNPOD_GLOBAL_NETWORKING === "1",
    interruptible: process.env.RUNPOD_INTERRUPTIBLE === "1",
    env: {
      QWEN_PROFILE: process.env.QWEN_PROFILE || "32b",
      VLLM_API_KEY: process.env.VLLM_API_KEY || process.env.VAST_OPENAI_API_KEY || "awal-runpod-key",
      DOC_PROCESSOR_API_KEY:
        process.env.DOC_PROCESSOR_API_KEY || "awal-docling-key",
      EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY || "awal-embedding-key",
      ENABLE_RERANK: process.env.ENABLE_RERANK || "0",
      HF_TOKEN: process.env.HF_TOKEN || "",
      REPO_URL: process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git"
    },
    dockerStartCmd: buildDockerStartCmd()
  };
}

async function updateRuntime(data: Prisma.GpuRuntimeUncheckedUpdateInput) {
  const prisma = getPrisma();
  const status = typeof data.status === "string" ? data.status : "asleep";

  return prisma.gpuRuntime.upsert({
    where: { id: DEFAULT_RUNTIME_ID },
    create: {
      id: DEFAULT_RUNTIME_ID,
      provider: "runpod",
      status,
      ...data
    } as Prisma.GpuRuntimeUncheckedCreateInput,
    update: data
  });
}

export async function getGpuRuntimeState() {
  const prisma = getPrisma();
  const runtime = await prisma.gpuRuntime.findUnique({
    where: { id: DEFAULT_RUNTIME_ID }
  });

  if (runtime) {
    return runtime;
  }

  return updateRuntime({
    status: "asleep"
  });
}

async function markPodReady(pod: RunPodPod) {
  const endpoints = buildEndpointsFromPod(pod);

  return updateRuntime({
    status: endpoints.llmBaseUrl && endpoints.embeddingBaseUrl ? "ready" : "waking",
    podId: pod.id,
    podName: pod.name || null,
    publicIp: endpoints.publicIp,
    llmBaseUrl: endpoints.llmBaseUrl,
    doclingBaseUrl: endpoints.doclingBaseUrl,
    embeddingBaseUrl: endpoints.embeddingBaseUrl,
    rerankBaseUrl: endpoints.rerankBaseUrl,
    portMappingsJson: pod.portMappings || {},
    lastHealthAt: new Date(),
    lastError: endpoints.llmBaseUrl ? null : "RunPod pod has no public vLLM port mapping yet."
  });
}

async function waitForRuntime(podId: string) {
  const attempts = optionalNumberEnv("RUNPOD_HEALTH_ATTEMPTS", 180);
  const delayMs = optionalNumberEnv("RUNPOD_HEALTH_DELAY_MS", 5000);
  const apiKey = process.env.VLLM_API_KEY || process.env.VAST_OPENAI_API_KEY || "awal-runpod-key";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const pod = await runpodFetch<RunPodPod>(`/pods/${podId}`);
    const endpoints = buildEndpointsFromPod(pod);

    if (endpoints.llmBaseUrl) {
      try {
        const response = await fetch(`${endpoints.llmBaseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });

        if (response.ok) {
          await markPodReady(pod);
          return pod;
        }
      } catch {
        // The pod exists, but the model server is still starting.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`RunPod pod ${podId} did not become healthy in time.`);
}

export async function wakeGpuRuntime(params: { waitForHealth?: boolean } = {}) {
  if (!isGpuRuntimeAutomationEnabled()) {
    throw new Error("RunPod automation is not enabled. Set RUNPOD_AUTOMATION_ENABLED=1 and RUNPOD_API_KEY.");
  }

  await updateRuntime({
    status: "waking",
    lastWakeAt: new Date(),
    lastError: null
  });

  const existing = await findActiveAwalPod();

  if (existing) {
    const runtime = await markPodReady(existing);

    if (params.waitForHealth) {
      await waitForRuntime(existing.id);
      return getGpuRuntimeState();
    }

    return runtime;
  }

  const pod = await runpodFetch<RunPodPod>("/pods", {
    method: "POST",
    body: JSON.stringify(buildCreatePodPayload())
  });

  await updateRuntime({
    status: "waking",
    podId: pod.id,
    podName: pod.name || null,
    lastWakeAt: new Date()
  });

  if (params.waitForHealth) {
    await waitForRuntime(pod.id);
    return getGpuRuntimeState();
  }

  return getGpuRuntimeState();
}

export async function sleepGpuRuntime() {
  if (!isGpuRuntimeAutomationEnabled()) {
    throw new Error("RunPod automation is not enabled. Set RUNPOD_AUTOMATION_ENABLED=1 and RUNPOD_API_KEY.");
  }

  await updateRuntime({
    status: "stopping",
    lastError: null
  });

  const pod = await findActiveAwalPod();

  if (!pod) {
    return updateRuntime({
      status: "asleep",
      podId: null,
      podName: null,
      publicIp: null,
      llmBaseUrl: null,
      doclingBaseUrl: null,
      embeddingBaseUrl: null,
      rerankBaseUrl: null,
      portMappingsJson: {},
      lastSleepAt: new Date()
    });
  }

  await runpodFetch(`/pods/${pod.id}`, {
    method: "DELETE"
  });

  return updateRuntime({
    status: "asleep",
    podId: null,
    podName: null,
    publicIp: null,
    llmBaseUrl: null,
    doclingBaseUrl: null,
    embeddingBaseUrl: null,
    rerankBaseUrl: null,
    portMappingsJson: {},
    lastSleepAt: new Date()
  });
}

export async function resolveGpuRuntimeEndpoints(params: { wakeOnDemand?: boolean } = {}) {
  const staticEndpoints = getGpuRuntimeStaticEndpoints();

  if (!isGpuRuntimeAutomationEnabled()) {
    return staticEndpoints;
  }

  const runtime = await getGpuRuntimeState();

  await updateRuntime({
    lastRequestAt: new Date()
  });

  if (runtime.status === "ready" && runtime.llmBaseUrl && runtime.embeddingBaseUrl) {
    return {
      llmBaseUrl: runtime.llmBaseUrl,
      doclingBaseUrl: runtime.doclingBaseUrl,
      embeddingBaseUrl: runtime.embeddingBaseUrl,
      rerankBaseUrl: runtime.rerankBaseUrl
    };
  }

  if (params.wakeOnDemand === false) {
    return staticEndpoints;
  }

  const awakened = await wakeGpuRuntime({ waitForHealth: true });

  return {
    llmBaseUrl: awakened.llmBaseUrl,
    doclingBaseUrl: awakened.doclingBaseUrl,
    embeddingBaseUrl: awakened.embeddingBaseUrl,
    rerankBaseUrl: awakened.rerankBaseUrl
  };
}

export async function sleepGpuRuntimeIfIdle() {
  const idleMinutes = optionalNumberEnv("RUNPOD_IDLE_MINUTES", 45);
  const runtime = await getGpuRuntimeState();

  if (runtime.status !== "ready" || !runtime.lastRequestAt) {
    return {
      slept: false,
      reason: "runtime_not_ready_or_no_request",
      runtime
    };
  }

  const idleMs = Date.now() - runtime.lastRequestAt.getTime();
  const idleLimitMs = idleMinutes * 60 * 1000;

  if (idleMs < idleLimitMs) {
    return {
      slept: false,
      reason: "not_idle",
      idleMinutes: idleMs / 60000,
      runtime
    };
  }

  const sleptRuntime = await sleepGpuRuntime();

  return {
    slept: true,
    reason: "idle_timeout",
    idleMinutes: idleMs / 60000,
    runtime: sleptRuntime
  };
}

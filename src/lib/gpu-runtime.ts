import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

const RUNPOD_REST_BASE_URL = process.env.RUNPOD_REST_BASE_URL || "https://rest.runpod.io/v1";
const RUNPOD_GRAPHQL_URL = process.env.RUNPOD_GRAPHQL_URL || "https://api.runpod.io/graphql";
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

type RunPodGraphqlPod = {
  id: string;
  name?: string | null;
  desiredStatus?: string | null;
  imageName?: string | null;
  machineId?: string | null;
  networkVolumeId?: string | null;
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

function getRunPodRuntimeMode() {
  const mode = process.env.RUNPOD_RUNTIME_MODE?.trim().toLowerCase();
  return mode === "full" ? "full" : "vllm";
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

async function runpodGraphqlFetch<TResponse>(query: string, variables: Record<string, unknown>) {
  const apiKey = getRunPodApiKey();

  if (!apiKey) {
    throw new Error("Missing RUNPOD_API_KEY.");
  }

  const response = await fetch(`${RUNPOD_GRAPHQL_URL}?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok || json?.errors?.length) {
    throw new Error(
      `RunPod GraphQL ${response.status}: ${JSON.stringify(json?.errors || json || text)}`
    );
  }

  return json.data as TResponse;
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

function hasHttpPort(pod: RunPodPod, port: number) {
  const ports = Array.isArray((pod as { ports?: unknown }).ports)
    ? ((pod as { ports?: string[] }).ports || [])
    : [];

  return ports.includes(`${port}/http`);
}

function buildHttpServiceBaseUrl(pod: RunPodPod, port: number) {
  const mapped = mappedPort(pod, port);

  if (pod.publicIp && mapped) {
    return `http://${pod.publicIp}:${mapped}`;
  }

  if (hasHttpPort(pod, port)) {
    return `https://${pod.id}-${port}.proxy.runpod.net`;
  }

  return null;
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

  const llmBaseUrl = buildHttpServiceBaseUrl(pod, 8000);
  const doclingBaseUrl = buildHttpServiceBaseUrl(pod, 8010);
  const embeddingBaseUrl = buildHttpServiceBaseUrl(pod, 8020);
  const rerankBaseUrl = buildHttpServiceBaseUrl(pod, 8030);

  return {
    publicIp,
    llmBaseUrl: llmBaseUrl ? `${llmBaseUrl}/v1` : null,
    doclingBaseUrl,
    embeddingBaseUrl,
    rerankBaseUrl
  };
}

async function checkLlmHealth(baseUrl: string) {
  const apiKey = process.env.VLLM_API_KEY || process.env.VAST_OPENAI_API_KEY || "awal-runpod-key";
  const timeoutMs = optionalNumberEnv("RUNPOD_QUICK_HEALTH_TIMEOUT_MS", 5000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
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
      `if [ -d /opt/awal/deploy/runpod ]; then rm -rf /workspace/Awal && cp -a /opt/awal /workspace/Awal; elif [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
      `bash /workspace/Awal/deploy/runpod/bootstrap-runpod.sh "${profile.replace(/"/g, '\\"')}"`
    ].join(" && ")
  ];
}

function buildDockerArgs() {
  const repoUrl = process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git";
  const profile = process.env.QWEN_PROFILE || "32b";
  const script = [
    "set -euo pipefail",
    "mkdir -p /workspace",
    `if [ -d /opt/awal/deploy/runpod ]; then rm -rf /workspace/Awal && cp -a /opt/awal /workspace/Awal; elif [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
    `bash /workspace/Awal/deploy/runpod/bootstrap-runpod.sh "${profile.replace(/"/g, '\\"')}"`
  ].join(" && ");

  return `bash -lc ${JSON.stringify(script)}`;
}

function buildCreatePodPayload() {
  const dataCenterId = process.env.RUNPOD_DATA_CENTER_ID?.trim();
  const networkVolumeId = process.env.RUNPOD_NETWORK_VOLUME_ID?.trim();
  const runtimeMode = getRunPodRuntimeMode();

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
    ports: (process.env.RUNPOD_PORTS ||
      (runtimeMode === "vllm"
        ? "8000/http,22/tcp"
        : "8000/http,8010/http,8020/http,8030/http,22/tcp"))
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
      RUNPOD_RUNTIME_MODE: runtimeMode,
      RUNPOD_FAST_START: process.env.RUNPOD_FAST_START || "1",
      RUNPOD_FORCE_INSTALL: process.env.RUNPOD_FORCE_INSTALL || "0",
      RUNPOD_KEEPALIVE: process.env.RUNPOD_KEEPALIVE || "1",
      AWAL_VENV_DIR: process.env.AWAL_VENV_DIR || "/workspace/venvs/awal-runtime",
      HF_HOME: process.env.HF_HOME || "/workspace/.cache/huggingface",
      HF_TOKEN: process.env.HF_TOKEN || "",
      REPO_URL: process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git"
    },
    dockerStartCmd: buildDockerStartCmd()
  };
}

function buildCreatePodGraphqlInput() {
  const payload = buildCreatePodPayload();
  const gpuTypeIds = Array.isArray(payload.gpuTypeIds) ? payload.gpuTypeIds : [];

  return {
    cloudType: payload.cloudType,
    computeType: payload.computeType,
    dataCenterId: payload.dataCenterIds[0],
    gpuTypeId: gpuTypeIds[0],
    gpuTypeIdList: gpuTypeIds,
    gpuCount: payload.gpuCount,
    name: payload.name,
    imageName: payload.imageName,
    containerDiskInGb: payload.containerDiskInGb,
    networkVolumeId: payload.networkVolumeId,
    volumeMountPath: payload.volumeMountPath,
    ports: payload.ports.join(","),
    supportPublicIp: payload.supportPublicIp,
    startSsh: true,
    startJupyter: false,
    dockerArgs: buildDockerArgs(),
    env: Object.entries(payload.env).map(([key, value]) => ({
      key,
      value
    }))
  };
}

async function createRunPodPod() {
  try {
    return await runpodFetch<RunPodPod>("/pods", {
      method: "POST",
      body: JSON.stringify(buildCreatePodPayload())
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("dataCenterIds") && !message.includes("schema requirements")) {
      throw error;
    }

    const data = await runpodGraphqlFetch<{
      podFindAndDeployOnDemand: RunPodGraphqlPod;
    }>(
      `mutation CreateAwalPod($input: PodFindAndDeployOnDemandInput) {
        podFindAndDeployOnDemand(input: $input) {
          id
          name
          desiredStatus
          imageName
          machineId
          networkVolumeId
        }
      }`,
      {
        input: buildCreatePodGraphqlInput()
      }
    );

    return {
      id: data.podFindAndDeployOnDemand.id,
      name: data.podFindAndDeployOnDemand.name || null,
      desiredStatus: data.podFindAndDeployOnDemand.desiredStatus || null,
      publicIp: null,
      portMappings: null
    };
  }
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
  const runtimeMode = getRunPodRuntimeMode();

  return updateRuntime({
    status:
      endpoints.llmBaseUrl && (runtimeMode === "vllm" || endpoints.embeddingBaseUrl)
        ? "ready"
        : "waking",
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

async function refreshRuntimeFromRunPod() {
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
      lastSleepAt: new Date(),
      lastError: null
    });
  }

  return markPodReady(pod);
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

  const pod = await createRunPodPod();

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

    if (
      runtime.status === "ready" &&
      runtime.llmBaseUrl &&
      (getRunPodRuntimeMode() === "vllm" || runtime.embeddingBaseUrl)
    ) {
    if (await checkLlmHealth(runtime.llmBaseUrl)) {
      await updateRuntime({
        lastHealthAt: new Date(),
        lastError: null
      });

      return {
        llmBaseUrl: runtime.llmBaseUrl,
        doclingBaseUrl: runtime.doclingBaseUrl,
        embeddingBaseUrl: runtime.embeddingBaseUrl,
        rerankBaseUrl: runtime.rerankBaseUrl
      };
    }

    await updateRuntime({
      status: "waking",
      lastError: "Stored RunPod endpoint is not reachable; refreshing runtime state."
    });
    const refreshed = await refreshRuntimeFromRunPod();

    if (
      refreshed.status === "ready" &&
      refreshed.llmBaseUrl &&
      (getRunPodRuntimeMode() === "vllm" || refreshed.embeddingBaseUrl) &&
      (await checkLlmHealth(refreshed.llmBaseUrl))
    ) {
      return {
        llmBaseUrl: refreshed.llmBaseUrl,
        doclingBaseUrl: refreshed.doclingBaseUrl,
        embeddingBaseUrl: refreshed.embeddingBaseUrl,
        rerankBaseUrl: refreshed.rerankBaseUrl
      };
    }

    if (params.wakeOnDemand === false) {
      return staticEndpoints;
    }
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

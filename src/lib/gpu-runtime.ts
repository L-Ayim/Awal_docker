import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

const RUNPOD_REST_BASE_URL = process.env.RUNPOD_REST_BASE_URL || "https://rest.runpod.io/v1";
const RUNPOD_GRAPHQL_URL = process.env.RUNPOD_GRAPHQL_URL || "https://api.runpod.io/graphql";
const CHAT_RUNTIME_ID = "default";
const INGEST_RUNTIME_ID = "ingest";

export type GpuRuntimeKind = "chat" | "ingest";

type RuntimeMode = "vllm" | "full" | "ingest";

type RuntimeEndpoints = {
  llmBaseUrl: string | null;
  doclingBaseUrl: string | null;
  embeddingBaseUrl: string | null;
  rerankBaseUrl: string | null;
};

type RuntimeProfile = {
  kind: GpuRuntimeKind;
  id: string;
  mode: RuntimeMode;
  namePrefix: string;
  podName: string;
  imageName: string;
  ports: string[];
  containerDiskGb: number;
};

type RunPodPod = {
  id: string;
  name?: string | null;
  desiredStatus?: string | null;
  publicIp?: string | null;
  portMappings?: Record<string, string | number> | null;
  ports?: string[] | null;
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

function csvEnv(name: string, fallback: string) {
  return (process.env[name] || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRunPodApiKey() {
  return process.env.RUNPOD_API_KEY?.trim() || "";
}

function getChatRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNPOD_RUNTIME_MODE?.trim().toLowerCase();
  return mode === "full" ? "full" : "vllm";
}

function normalizeRuntimeKind(kind?: GpuRuntimeKind) {
  return kind === "ingest" ? "ingest" : "chat";
}

function getRuntimeProfile(kind: GpuRuntimeKind = "chat"): RuntimeProfile {
  if (kind === "ingest") {
    const prefix = process.env.RUNPOD_INGEST_POD_NAME_PREFIX || "awal-ingest";

    return {
      kind,
      id: INGEST_RUNTIME_ID,
      mode: "ingest",
      namePrefix: prefix,
      podName: process.env.RUNPOD_INGEST_POD_NAME || `${prefix}-${Date.now()}`,
      imageName: process.env.RUNPOD_INGEST_IMAGE || "ghcr.io/l-ayim/awal-runpod-ingest:latest",
      ports: csvEnv("RUNPOD_INGEST_PORTS", "8010/http,8020/http,8030/http,22/tcp"),
      containerDiskGb: optionalNumberEnv("RUNPOD_INGEST_CONTAINER_DISK_GB", 40)
    };
  }

  const mode = getChatRuntimeMode();
  const prefix = process.env.RUNPOD_POD_NAME_PREFIX || "awal-32b";

  return {
    kind,
    id: CHAT_RUNTIME_ID,
    mode,
    namePrefix: prefix,
    podName: process.env.RUNPOD_POD_NAME || `${prefix}-${Date.now()}`,
    imageName:
      process.env.RUNPOD_IMAGE ||
      (mode === "vllm"
        ? "ghcr.io/l-ayim/awal-runpod-vllm:latest"
        : "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04"),
    ports: csvEnv(
      "RUNPOD_PORTS",
      mode === "vllm" ? "8000/http,22/tcp" : "8000/http,8010/http,8020/http,8030/http,22/tcp"
    ),
    containerDiskGb: optionalNumberEnv("RUNPOD_CONTAINER_DISK_GB", 50)
  };
}

export function isGpuRuntimeAutomationEnabled() {
  return process.env.RUNPOD_AUTOMATION_ENABLED === "1" && Boolean(getRunPodApiKey());
}

export function getGpuRuntimeStaticEndpoints(kind: GpuRuntimeKind = "chat"): RuntimeEndpoints {
  if (kind === "ingest") {
    return {
      llmBaseUrl: null,
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

function isProfilePod(pod: RunPodPod, profile: RuntimeProfile) {
  return String(pod.name || "").startsWith(profile.namePrefix);
}

function isActivePod(pod: RunPodPod) {
  const desiredStatus = String(pod.desiredStatus || "").toUpperCase();
  return desiredStatus !== "TERMINATED" && desiredStatus !== "EXITED";
}

async function findActiveRuntimePod(profile: RuntimeProfile) {
  const pods = await listPods();
  return pods.find((pod) => isProfilePod(pod, profile) && isActivePod(pod)) || null;
}

function mappedPort(pod: RunPodPod, port: number) {
  const mappings = pod.portMappings || {};
  return mappings[String(port)] || mappings[port];
}

function hasHttpPort(pod: RunPodPod, port: number) {
  const ports = Array.isArray(pod.ports) ? pod.ports : [];
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
  const llmBaseUrl = buildHttpServiceBaseUrl(pod, 8000);
  const doclingBaseUrl = buildHttpServiceBaseUrl(pod, 8010);
  const embeddingBaseUrl = buildHttpServiceBaseUrl(pod, 8020);
  const rerankBaseUrl = buildHttpServiceBaseUrl(pod, 8030);

  return {
    publicIp: pod.publicIp || null,
    llmBaseUrl: llmBaseUrl ? `${llmBaseUrl}/v1` : null,
    doclingBaseUrl,
    embeddingBaseUrl,
    rerankBaseUrl
  };
}

function isEndpointShapeReady(endpoints: RuntimeEndpoints, profile: RuntimeProfile) {
  if (profile.mode === "ingest") {
    return Boolean(endpoints.doclingBaseUrl && endpoints.embeddingBaseUrl);
  }

  if (profile.mode === "vllm") {
    return Boolean(endpoints.llmBaseUrl);
  }

  return Boolean(endpoints.llmBaseUrl && endpoints.embeddingBaseUrl);
}

async function checkHttpHealth(url: string, headers?: HeadersInit) {
  const timeoutMs = optionalNumberEnv("RUNPOD_QUICK_HEALTH_TIMEOUT_MS", 5000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkRuntimeHealth(endpoints: RuntimeEndpoints, profile: RuntimeProfile) {
  if (profile.mode === "ingest") {
    return Boolean(
      endpoints.doclingBaseUrl &&
        endpoints.embeddingBaseUrl &&
        (await checkHttpHealth(`${endpoints.doclingBaseUrl}/health`)) &&
        (await checkHttpHealth(`${endpoints.embeddingBaseUrl}/health`))
    );
  }

  if (!endpoints.llmBaseUrl) {
    return false;
  }

  const apiKey = process.env.VLLM_API_KEY || process.env.VAST_OPENAI_API_KEY || "awal-runpod-key";
  return checkHttpHealth(`${endpoints.llmBaseUrl}/models`, {
    Authorization: `Bearer ${apiKey}`
  });
}

function buildChatStartScript(profile: RuntimeProfile) {
  const repoUrl = process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git";
  const qwenProfile = process.env.QWEN_PROFILE || "32b";

  if (profile.mode === "vllm") {
    return [
      "set -euo pipefail",
      "mkdir -p /workspace/Awal /workspace/logs /workspace/.cache/huggingface",
      `if [ -d /opt/awal/deploy/runpod ]; then rsync -a --delete --exclude .git /opt/awal/ /workspace/Awal/; elif [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
      `cd /workspace/Awal && API_KEY="$${"VLLM_API_KEY"}" HF_HOME="$${"HF_HOME"}" bash /workspace/Awal/deploy/runpod/vllm/run-qwen3.sh "${qwenProfile.replace(/"/g, '\\"')}"`
    ].join(" && ");
  }

  return [
    "set -euo pipefail",
    "mkdir -p /workspace",
    `if [ -d /opt/awal/deploy/runpod ]; then rm -rf /workspace/Awal && cp -a /opt/awal /workspace/Awal; elif [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
    `bash /workspace/Awal/deploy/runpod/bootstrap-runpod.sh "${qwenProfile.replace(/"/g, '\\"')}"`
  ].join(" && ");
}

function buildIngestStartScript() {
  const repoUrl = process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git";

  return [
    "set -euo pipefail",
    "mkdir -p /workspace/Awal /workspace/logs /workspace/.cache/huggingface",
    `if [ -d /opt/awal/deploy/runpod ]; then rsync -a --delete --exclude .git /opt/awal/ /workspace/Awal/; elif [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone "${repoUrl.replace(/"/g, '\\"')}" /workspace/Awal; fi`,
    "bash /workspace/Awal/deploy/runpod/ingest/start-ingest.sh"
  ].join(" && ");
}

function buildRuntimeStartScript(profile: RuntimeProfile) {
  return profile.kind === "ingest" ? buildIngestStartScript() : buildChatStartScript(profile);
}

function buildDockerStartCmd(profile: RuntimeProfile) {
  return ["bash", "-lc", buildRuntimeStartScript(profile)];
}

function buildDockerArgs(profile: RuntimeProfile) {
  return `bash -lc ${JSON.stringify(buildRuntimeStartScript(profile))}`;
}

function buildRuntimeEnv(profile: RuntimeProfile) {
  return {
    QWEN_PROFILE: process.env.QWEN_PROFILE || "32b",
    VLLM_API_KEY: process.env.VLLM_API_KEY || process.env.VAST_OPENAI_API_KEY || "awal-runpod-key",
    DOC_PROCESSOR_API_KEY: process.env.DOC_PROCESSOR_API_KEY || "awal-docling-key",
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY || "awal-embedding-key",
    RERANK_API_KEY: process.env.RERANK_API_KEY || "awal-rerank-key",
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || process.env.VAST_EMBEDDING_MODEL || "BAAI/bge-m3",
    RERANK_MODEL: process.env.RERANK_MODEL || process.env.VAST_RERANK_MODEL || "BAAI/bge-reranker-v2-m3",
    DOCLING_DEVICE: process.env.DOCLING_DEVICE || "cuda",
    ENABLE_RERANK: process.env.ENABLE_RERANK || "0",
    RUNPOD_RUNTIME_MODE: profile.mode,
    RUNPOD_FAST_START: process.env.RUNPOD_FAST_START || "1",
    RUNPOD_FORCE_INSTALL: process.env.RUNPOD_FORCE_INSTALL || "0",
    RUNPOD_KEEPALIVE: process.env.RUNPOD_KEEPALIVE || "1",
    AWAL_VENV_DIR: process.env.AWAL_VENV_DIR || "/workspace/venvs/awal-runtime",
    AWAL_INGEST_VENV_DIR: process.env.AWAL_INGEST_VENV_DIR || "/opt/awal-ingest-venv",
    HF_HOME: process.env.HF_HOME || "/workspace/.cache/huggingface",
    HF_TOKEN: process.env.HF_TOKEN || "",
    REPO_URL: process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git"
  };
}

function buildCreatePodPayload(profile: RuntimeProfile) {
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
    name: profile.podName,
    cloudType: process.env.RUNPOD_CLOUD_TYPE || "SECURE",
    computeType: "GPU",
    dataCenterIds: [dataCenterId],
    dataCenterPriority: "availability",
    gpuTypeIds,
    gpuTypePriority: "availability",
    gpuCount: optionalNumberEnv(profile.kind === "ingest" ? "RUNPOD_INGEST_GPU_COUNT" : "RUNPOD_GPU_COUNT", 1),
    imageName: profile.imageName,
    containerDiskInGb: profile.containerDiskGb,
    networkVolumeId,
    volumeMountPath: "/workspace",
    ports: profile.ports,
    supportPublicIp: true,
    globalNetworking: process.env.RUNPOD_GLOBAL_NETWORKING === "1",
    interruptible: process.env.RUNPOD_INTERRUPTIBLE === "1",
    env: buildRuntimeEnv(profile),
    dockerStartCmd: buildDockerStartCmd(profile)
  };
}

function buildCreatePodGraphqlInput(profile: RuntimeProfile) {
  const payload = buildCreatePodPayload(profile);
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
    dockerArgs: buildDockerArgs(profile),
    env: Object.entries(payload.env).map(([key, value]) => ({
      key,
      value
    }))
  };
}

async function createRunPodPod(profile: RuntimeProfile) {
  try {
    return await runpodFetch<RunPodPod>("/pods", {
      method: "POST",
      body: JSON.stringify(buildCreatePodPayload(profile))
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
        input: buildCreatePodGraphqlInput(profile)
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

async function updateRuntime(data: Prisma.GpuRuntimeUncheckedUpdateInput, kind: GpuRuntimeKind = "chat") {
  const prisma = getPrisma();
  const profile = getRuntimeProfile(kind);
  const status = typeof data.status === "string" ? data.status : "asleep";

  return prisma.gpuRuntime.upsert({
    where: { id: profile.id },
    create: {
      id: profile.id,
      provider: "runpod",
      status,
      ...data
    } as Prisma.GpuRuntimeUncheckedCreateInput,
    update: data
  });
}

export async function getGpuRuntimeState(kind: GpuRuntimeKind = "chat") {
  const prisma = getPrisma();
  const profile = getRuntimeProfile(kind);
  const runtime = await prisma.gpuRuntime.findUnique({
    where: { id: profile.id }
  });

  if (runtime) {
    return runtime;
  }

  return updateRuntime(
    {
      status: "asleep"
    },
    kind
  );
}

async function markPodReady(pod: RunPodPod, profile: RuntimeProfile) {
  const endpoints = buildEndpointsFromPod(pod);
  const ready = isEndpointShapeReady(endpoints, profile);

  return updateRuntime(
    {
      status: ready ? "ready" : "waking",
      podId: pod.id,
      podName: pod.name || null,
      publicIp: endpoints.publicIp,
      llmBaseUrl: endpoints.llmBaseUrl,
      doclingBaseUrl: endpoints.doclingBaseUrl,
      embeddingBaseUrl: endpoints.embeddingBaseUrl,
      rerankBaseUrl: endpoints.rerankBaseUrl,
      portMappingsJson: pod.portMappings || {},
      lastHealthAt: new Date(),
      lastError: ready ? null : `RunPod ${profile.kind} pod has no public service port mapping yet.`
    },
    profile.kind
  );
}

async function refreshRuntimeFromRunPod(profile: RuntimeProfile) {
  const pod = await findActiveRuntimePod(profile);

  if (!pod) {
    return updateRuntime(
      {
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
      },
      profile.kind
    );
  }

  return markPodReady(pod, profile);
}

async function waitForRuntime(podId: string, profile: RuntimeProfile) {
  const attempts = optionalNumberEnv("RUNPOD_HEALTH_ATTEMPTS", 180);
  const delayMs = optionalNumberEnv("RUNPOD_HEALTH_DELAY_MS", 5000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const pod = await runpodFetch<RunPodPod>(`/pods/${podId}`);
    const endpoints = buildEndpointsFromPod(pod);

    if (isEndpointShapeReady(endpoints, profile) && (await checkRuntimeHealth(endpoints, profile))) {
      await markPodReady(pod, profile);
      return pod;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`RunPod ${profile.kind} pod ${podId} did not become healthy in time.`);
}

export async function wakeGpuRuntime(
  params: { waitForHealth?: boolean; kind?: GpuRuntimeKind } = {}
) {
  if (!isGpuRuntimeAutomationEnabled()) {
    throw new Error("RunPod automation is not enabled. Set RUNPOD_AUTOMATION_ENABLED=1 and RUNPOD_API_KEY.");
  }

  const kind = normalizeRuntimeKind(params.kind);
  const profile = getRuntimeProfile(kind);

  await updateRuntime(
    {
      status: "waking",
      lastWakeAt: new Date(),
      lastError: null
    },
    kind
  );

  const existing = await findActiveRuntimePod(profile);

  if (existing) {
    const runtime = await markPodReady(existing, profile);

    if (params.waitForHealth) {
      await waitForRuntime(existing.id, profile);
      return getGpuRuntimeState(kind);
    }

    return runtime;
  }

  const pod = await createRunPodPod(profile);

  await updateRuntime(
    {
      status: "waking",
      podId: pod.id,
      podName: pod.name || null,
      lastWakeAt: new Date()
    },
    kind
  );

  if (params.waitForHealth) {
    await waitForRuntime(pod.id, profile);
    return getGpuRuntimeState(kind);
  }

  return getGpuRuntimeState(kind);
}

export async function sleepGpuRuntime(params: { kind?: GpuRuntimeKind } = {}) {
  if (!isGpuRuntimeAutomationEnabled()) {
    throw new Error("RunPod automation is not enabled. Set RUNPOD_AUTOMATION_ENABLED=1 and RUNPOD_API_KEY.");
  }

  const kind = normalizeRuntimeKind(params.kind);
  const profile = getRuntimeProfile(kind);

  await updateRuntime(
    {
      status: "stopping",
      lastError: null
    },
    kind
  );

  const pod = await findActiveRuntimePod(profile);

  if (pod) {
    await runpodFetch(`/pods/${pod.id}`, {
      method: "DELETE"
    });
  }

  return updateRuntime(
    {
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
    },
    kind
  );
}

export async function resolveGpuRuntimeEndpoints(
  params: { wakeOnDemand?: boolean; kind?: GpuRuntimeKind } = {}
) {
  const kind = normalizeRuntimeKind(params.kind);
  const profile = getRuntimeProfile(kind);
  const staticEndpoints = getGpuRuntimeStaticEndpoints(kind);

  if (!isGpuRuntimeAutomationEnabled()) {
    return staticEndpoints;
  }

  const runtime = await getGpuRuntimeState(kind);

  await updateRuntime(
    {
      lastRequestAt: new Date()
    },
    kind
  );

  const runtimeEndpoints = {
    llmBaseUrl: runtime.llmBaseUrl,
    doclingBaseUrl: runtime.doclingBaseUrl,
    embeddingBaseUrl: runtime.embeddingBaseUrl,
    rerankBaseUrl: runtime.rerankBaseUrl
  };

  if (runtime.status === "ready" && isEndpointShapeReady(runtimeEndpoints, profile)) {
    if (await checkRuntimeHealth(runtimeEndpoints, profile)) {
      await updateRuntime(
        {
          lastHealthAt: new Date(),
          lastError: null
        },
        kind
      );

      return runtimeEndpoints;
    }

    await updateRuntime(
      {
        status: "waking",
        lastError: "Stored RunPod endpoint is not reachable; refreshing runtime state."
      },
      kind
    );

    const refreshed = await refreshRuntimeFromRunPod(profile);
    const refreshedEndpoints = {
      llmBaseUrl: refreshed.llmBaseUrl,
      doclingBaseUrl: refreshed.doclingBaseUrl,
      embeddingBaseUrl: refreshed.embeddingBaseUrl,
      rerankBaseUrl: refreshed.rerankBaseUrl
    };

    if (
      refreshed.status === "ready" &&
      isEndpointShapeReady(refreshedEndpoints, profile) &&
      (await checkRuntimeHealth(refreshedEndpoints, profile))
    ) {
      return refreshedEndpoints;
    }
  }

  if (params.wakeOnDemand === false) {
    return staticEndpoints;
  }

  const awakened = await wakeGpuRuntime({ waitForHealth: true, kind });

  return {
    llmBaseUrl: awakened.llmBaseUrl,
    doclingBaseUrl: awakened.doclingBaseUrl,
    embeddingBaseUrl: awakened.embeddingBaseUrl,
    rerankBaseUrl: awakened.rerankBaseUrl
  };
}

export async function sleepGpuRuntimeIfIdle(params: { kind?: GpuRuntimeKind } = {}) {
  const kind = normalizeRuntimeKind(params.kind);
  const idleMinutes =
    kind === "ingest"
      ? optionalNumberEnv("RUNPOD_INGEST_IDLE_MINUTES", optionalNumberEnv("RUNPOD_IDLE_MINUTES", 45))
      : optionalNumberEnv("RUNPOD_IDLE_MINUTES", 45);
  const runtime = await getGpuRuntimeState(kind);

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

  const sleptRuntime = await sleepGpuRuntime({ kind });

  return {
    slept: true,
    reason: "idle_timeout",
    idleMinutes: idleMs / 60000,
    runtime: sleptRuntime
  };
}

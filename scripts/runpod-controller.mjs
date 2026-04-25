#!/usr/bin/env node

const RUNPOD_REST_BASE_URL = process.env.RUNPOD_REST_BASE_URL || "https://rest.runpod.io/v1";

const command = process.argv[2] || "status";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function optionalNumberEnv(name, fallback) {
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

async function runpodFetch(path, options = {}) {
  const apiKey = requiredEnv("RUNPOD_API_KEY");
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
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function listPods() {
  return runpodFetch("/pods");
}

function isAwalPod(pod) {
  const name = String(pod?.name || "");
  const prefix = process.env.RUNPOD_POD_NAME_PREFIX || "awal-32b";
  return name.startsWith(prefix);
}

function isActivePod(pod) {
  const desiredStatus = String(pod?.desiredStatus || "").toUpperCase();
  return desiredStatus !== "TERMINATED" && desiredStatus !== "EXITED";
}

async function findActiveAwalPod() {
  const pods = await listPods();
  return pods.find((pod) => isAwalPod(pod) && isActivePod(pod)) || null;
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
      "if [ -d /workspace/Awal/.git ]; then git -C /workspace/Awal pull --ff-only; else rm -rf /workspace/Awal && git clone \"$REPO_URL\" /workspace/Awal; fi",
      "bash /workspace/Awal/deploy/runpod/bootstrap-runpod.sh \"$QWEN_PROFILE\""
    ].join(" && ")
  ].map((part) =>
    part
      .replace("$REPO_URL", repoUrl.replace(/"/g, '\\"'))
      .replace("$QWEN_PROFILE", profile.replace(/"/g, '\\"'))
  );
}

function buildCreatePodPayload() {
  const gpuTypeIds = (process.env.RUNPOD_GPU_TYPE_IDS ||
    "NVIDIA RTX PRO 6000 Blackwell Server Edition,NVIDIA H200,NVIDIA H100 80GB HBM3")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    name: process.env.RUNPOD_POD_NAME || `awal-32b-${Date.now()}`,
    cloudType: "SECURE",
    computeType: "GPU",
    dataCenterIds: [requiredEnv("RUNPOD_DATA_CENTER_ID")],
    dataCenterPriority: "availability",
    gpuTypeIds,
    gpuTypePriority: "availability",
    gpuCount: optionalNumberEnv("RUNPOD_GPU_COUNT", 1),
    imageName:
      process.env.RUNPOD_IMAGE ||
      "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04",
    containerDiskInGb: optionalNumberEnv("RUNPOD_CONTAINER_DISK_GB", 50),
    networkVolumeId: requiredEnv("RUNPOD_NETWORK_VOLUME_ID"),
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
      VLLM_API_KEY: process.env.VLLM_API_KEY || "awal-runpod-key",
      DOC_PROCESSOR_API_KEY: process.env.DOC_PROCESSOR_API_KEY || "awal-docling-key",
      EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY || "awal-embedding-key",
      ENABLE_RERANK: process.env.ENABLE_RERANK || "0",
      HF_TOKEN: process.env.HF_TOKEN || "",
      REPO_URL: process.env.REPO_URL || "https://github.com/L-Ayim/Awal_docker.git"
    },
    dockerStartCmd: buildDockerStartCmd()
  };
}

function getPodBaseUrl(pod) {
  const publicIp = pod?.publicIp;
  const portMappings = pod?.portMappings || {};
  const mappedPort = portMappings["8000"] || portMappings[8000];

  if (!publicIp || !mappedPort) {
    return null;
  }

  return `http://${publicIp}:${mappedPort}`;
}

async function waitForModel(podId) {
  const apiKey = process.env.VLLM_API_KEY || "awal-runpod-key";
  const attempts = optionalNumberEnv("RUNPOD_HEALTH_ATTEMPTS", 180);
  const delayMs = optionalNumberEnv("RUNPOD_HEALTH_DELAY_MS", 5000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const pod = await runpodFetch(`/pods/${podId}`);
    const baseUrl = getPodBaseUrl(pod);

    if (baseUrl) {
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });

        if (response.ok) {
          return {
            pod,
            baseUrl: `${baseUrl}/v1`
          };
        }
      } catch {
        // Pod is still booting or vLLM is still loading the model.
      }
    }

    if (attempt % 12 === 0) {
      console.log(`waiting for model server (${attempt}/${attempts})`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Pod ${podId} did not become healthy in time.`);
}

async function wake() {
  const existing = await findActiveAwalPod();

  if (existing) {
    console.log(JSON.stringify({ status: "already_running", pod: existing }, null, 2));
    return;
  }

  const payload = buildCreatePodPayload();
  const pod = await runpodFetch("/pods", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  console.log(JSON.stringify({ status: "created", pod }, null, 2));

  if (process.env.RUNPOD_WAIT_FOR_HEALTH === "1") {
    const healthy = await waitForModel(pod.id);
    console.log(JSON.stringify({ status: "healthy", ...healthy }, null, 2));
  }
}

async function sleepPod() {
  const pod = await findActiveAwalPod();

  if (!pod) {
    console.log(JSON.stringify({ status: "not_running" }, null, 2));
    return;
  }

  if (process.env.RUNPOD_CONFIRM_TERMINATE !== "1") {
    throw new Error(
      `Refusing to terminate ${pod.id} without RUNPOD_CONFIRM_TERMINATE=1. Network-volume data survives, but container disk is deleted.`
    );
  }

  await runpodFetch(`/pods/${pod.id}`, {
    method: "DELETE"
  });

  console.log(JSON.stringify({ status: "terminated", podId: pod.id }, null, 2));
}

async function status() {
  const pod = await findActiveAwalPod();

  if (!pod) {
    console.log(JSON.stringify({ status: "not_running" }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: "running",
        podId: pod.id,
        name: pod.name,
        desiredStatus: pod.desiredStatus,
        gpu: pod.gpu?.displayName || pod.gpu?.id || null,
        publicIp: pod.publicIp || null,
        portMappings: pod.portMappings || {},
        modelBaseUrl: getPodBaseUrl(pod) ? `${getPodBaseUrl(pod)}/v1` : null
      },
      null,
      2
    )
  );
}

async function main() {
  if (command === "wake") {
    await wake();
    return;
  }

  if (command === "sleep") {
    await sleepPod();
    return;
  }

  if (command === "status") {
    await status();
    return;
  }

  throw new Error(`Unknown command: ${command}. Use wake, sleep, or status.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

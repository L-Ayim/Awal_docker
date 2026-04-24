#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"|"$/g, "");
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, ...valueParts] = arg.split("=");
  args.set(key.replace(/^--/, ""), valueParts.join("=") || "1");
}

const baselineModel = args.get("baseline") ?? "Qwen/Qwen3-14B";
const targetModel = args.get("target") ?? "Qwen/Qwen3-1.7B";
const targetLabel = args.get("target-label") ?? targetModel;
const appUrl = (args.get("app-url") ?? "https://awal-app.fly.dev").replace(/\/$/, "");
const limit = Number(args.get("limit") ?? "12");
const outputPath = path.resolve(args.get("out") ?? "reports/model-replay-2b.md");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient();

function normalizeQuestion(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function truncate(value, length = 1200) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return payload;
}

async function collectBaselinePairs() {
  const assistantMessages = await prisma.message.findMany({
    where: {
      role: "assistant",
      answerRecord: {
        modelName: baselineModel
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      conversation: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
          collectionId: true
        }
      },
      answerRecord: {
        include: {
          citations: {
            include: {
              citationSpan: {
                include: {
                  chunk: {
                    include: {
                      documentRevision: {
                        include: {
                          document: {
                            select: {
                              title: true
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const pairs = [];
  const seenQuestions = new Set();

  for (const assistantMessage of assistantMessages) {
    const previousUser = await prisma.message.findFirst({
      where: {
        conversationId: assistantMessage.conversationId,
        role: "user",
        createdAt: {
          lt: assistantMessage.createdAt
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!previousUser) {
      continue;
    }

    const key = normalizeQuestion(previousUser.content);

    if (seenQuestions.has(key)) {
      continue;
    }

    seenQuestions.add(key);
    pairs.push({
      question: previousUser.content,
      baselineAnswer: assistantMessage.content,
      baselineState: assistantMessage.answerRecord?.state ?? null,
      baselineCitations:
        assistantMessage.answerRecord?.citations.map(
          (citation) =>
            citation.citationSpan.chunk.documentRevision.document.title
        ) ?? [],
      sourceConversation: assistantMessage.conversation
    });

    if (pairs.length >= limit) {
      break;
    }
  }

  return pairs.reverse();
}

async function main() {
  const pairs = await collectBaselinePairs();

  if (pairs.length === 0) {
    throw new Error(`No baseline answers found for ${baselineModel}.`);
  }

  const workspaceId = pairs[0].sourceConversation.workspaceId;
  const collectionId = pairs[0].sourceConversation.collectionId;

  const conversationResponse = await fetchJson(`${appUrl}/api/v1/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workspaceId,
      collectionId,
      title: `Model replay ${targetModel}`
    })
  });

  const conversationId = conversationResponse.conversation.id;
  const results = [];

  for (const [index, pair] of pairs.entries()) {
    console.log(`[${index + 1}/${pairs.length}] ${pair.question}`);

    const response = await fetchJson(
      `${appUrl}/api/v1/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: pair.question
        })
      }
    );

    results.push({
      ...pair,
      targetAnswer: response.assistantMessage.content,
      targetState: response.assistantMessage.answerRecord?.state ?? response.answerRecord?.state,
      targetModel:
        response.assistantMessage.answerRecord?.modelName ?? response.answerRecord?.modelName,
      targetCitations:
        response.assistantMessage.answerRecord?.citations.map(
          (citation) => citation.document.title
        ) ?? []
    });
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const markdown = [
    `# Model Replay: ${baselineModel} vs ${targetModel}`,
    "",
    `App: ${appUrl}`,
    `Conversation: ${conversationId}`,
    `Questions: ${results.length}`,
    "",
    ...results.flatMap((result, index) => [
      `## ${index + 1}. ${result.question}`,
      "",
      `Baseline state: ${result.baselineState ?? "unknown"}`,
      `Target state: ${result.targetState ?? "unknown"}`,
      "",
      "### 14B Baseline",
      "",
      truncate(result.baselineAnswer),
      "",
      `References: ${[...new Set(result.baselineCitations)].join("; ") || "none"}`,
      "",
      `### Target (${targetLabel})`,
      "",
      truncate(result.targetAnswer),
      "",
      `References: ${[...new Set(result.targetCitations)].join("; ") || "none"}`,
      ""
    ])
  ].join("\n");

  fs.writeFileSync(outputPath, markdown);
  console.log(`Wrote ${outputPath}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

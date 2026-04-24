# Model Size Evaluation

Use this runbook to compare whether Awal's retrieval, reranking, answer generation, and verification architecture still works with smaller Qwen models.

## Profiles

| Profile | Served model | Purpose |
| --- | --- | --- |
| `2b` | `Qwen/Qwen3-1.7B` | Stress test grounding with a very small model. |
| `4b` | `Qwen/Qwen3-4B-Instruct-2507` | Test the smallest practical general model. |
| `8b` | `Qwen/Qwen3-8B` | Middle ground for quality versus cost. |
| `14b` | `Qwen/Qwen3-14B` | Current quality baseline. |

## Switch Models

On the Vast box:

```bash
pkill -f "vllm" || true
cd /workspace/Awal
nohup bash deploy/vast/vllm/run-qwen3.sh 8b > /workspace/vllm.log 2>&1 &
```

Wait until `/workspace/vllm.log` shows `Application startup complete`, then check:

```bash
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer awal-vast-key"
```

Update Fly to match the active model:

```bash
flyctl secrets set VAST_LLM_MODEL="Qwen/Qwen3-8B"
curl https://awal-app.fly.dev/api/health
```

## Test Method

Use the same document set, same database, same embeddings, and same questions for every model. Only change the vLLM model. This isolates whether the generator size is the limiting factor.

Score each answer:

- `2`: correct, grounded, useful, references match the claim.
- `1`: mostly correct but misses nuance, is too vague, or references are weak.
- `0`: hallucinated, unsupported, or refuses despite available evidence.

## Question Set

Use a mix of direct lookup, synthesis, advice, and negative-control questions:

```text
Can I send bank files to a friend on WhatsApp?
What does the change management procedure require before production changes are approved?
Summarize the cloud services policy in practical terms.
What does the web filtering policy say about internet access?
Who are the people mentioned in compliance or information security governance?
If I need to take work documents home, what should I check first based on the policies?
What risks do the data leakage documents seem most concerned about?
Compare the data leakage policy and web filtering policy. Where do they overlap?
What should I do if I need an exception to access a blocked website?
Who is Batman according to these documents?
```

The Batman question should stay grounded and say the documents do not provide that information.

## Expected Outcome

If the architecture is strong, 8B should be close to 14B on direct and policy-advice questions. 4B may work well when references are strong, but should be watched for missed nuance. The 2B profile is mostly a stress test: good retrieval may keep it useful, but it will likely need shorter answers and stricter verification to avoid overconfident summaries.

# Fixing real Titan embeddings

`pnpm embed:verify` currently **fails** — the app is silently using the local
hash embedding fallback. Only 2 distinct values in a 1024-dim vector means
semantic recall is effectively keyword matching. This must be fixed before the
demo, or the Distributed Vector Indexing centerpiece is fake.

## The fix (one-time, in the AWS console)

1. **Enable the model in Bedrock Model access**
   - AWS Console → Amazon Bedrock → **Model access** (us-east-1).
   - Click **Modify model access** → check **Amazon Titan Text Embeddings V2** → submit.
   - Access is granted instantly for Titan. Done.

2. **Confirm IAM has `bedrock:InvokeModel`**
   - The IAM user/role behind `AWS_ACCESS_KEY_ID` needs a policy allowing
     `bedrock:InvokeModel` on
     `arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0`.
   - The managed policy `AmazonBedrockFullAccess` covers it. If you're using a
     scoped policy, add the action.

3. **Verify & re-seed**
   ```bash
   pnpm embed:verify          # should PASS with hundreds of distinct values
   pnpm db:seed-embeddings     # regenerate all embeddings through the real path
   ```
   After re-seeding, paraphrase queries like "who's recruiting frontend people?"
   should recall Sarah Chen even without keyword overlap.

## Why this matters for judging

The hackathon's #1 criterion is **Agentic Memory Design** — does CockroachDB play
a meaningful role as the memory layer? Real Titan embeddings + the
`memory_embedding_idx` distributed vector index are what prove that. The hash
fallback is a deliberate safety net for judges who run the app with no AWS
credentials; it is NOT what the live demo should use.

If model access cannot be enabled in time, the fallback path is honest and
documented (it's logged and the README explains it) — but fix it if you can.

import { shortBlobId, walrusBlobUrl } from "@/lib/memwal";

/**
 * Link chip to the Seal-encrypted Walrus blob behind a memory.
 * Anyone can fetch the bytes; only the owner's delegate key can read them —
 * publicly verifiable, privately readable.
 */
export function BlobChip({ blobId }: { blobId: string }) {
  return (
    <a
      href={walrusBlobUrl(blobId)}
      target="_blank"
      rel="noreferrer"
      title={`Seal-encrypted Walrus blob ${blobId} — fetchable by anyone, readable only by you`}
      className="inline-flex items-center gap-1 rounded-md border border-ink/10 bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink/50 transition hover:border-accent/40 hover:text-accent"
    >
      <span aria-hidden>⬡</span>
      {shortBlobId(blobId)}
    </a>
  );
}

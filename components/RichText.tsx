import React, { Fragment, type ReactNode } from "react";

/**
 * Minimal markdown renderer for model-generated answers.
 *
 * Synthesis (Voxtral) emits light markdown — **bold**, *italic*, `code`,
 * lists — which read as raw asterisks when rendered as plain text
 * ("You met **one** founder"). This renders that subset as real elements.
 *
 * Safety: output is built from React nodes, never innerHTML, so answer text
 * (or a quoted memory) can never inject markup. Raw user content elsewhere
 * (citations, memories) stays plain strings on purpose.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  // Opening/closing markers must hug non-space content (CommonMark
  // left-flanking rule), so stray asterisks like "5* rating" stay literal
  // instead of italicizing half the sentence.
  const parts = text.split(/(\*\*\S(?:.*?\S)?\*\*|\*\S(?:.*?\S)?\*|`\S(?:.*?\S)?`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-ink/5 px-1 font-mono text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const chunks = text.split(/\n\s*\n/);
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      blocks.push({ kind: "ul", items: lines.map((l) => l.replace(/^[-*]\s+/, "")) });
    } else if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
      blocks.push({ kind: "ol", items: lines.map((l) => l.replace(/^\d+[.)]\s+/, "")) });
    } else {
      blocks.push({ kind: "p", lines });
    }
  }
  return blocks;
}

export function RichText({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, `u${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, `o${i}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, `p${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

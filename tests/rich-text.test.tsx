import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "@/components/RichText";

/**
 * The synthesis model emits light markdown ("You met **one** founder").
 * Rendered as plain text it reads as raw asterisks; rendered rich it reads
 * as an answer. These lock the renderer: formatting works, injection can't.
 */
describe("RichText", () => {
  it("renders the exact user complaint as rich text, not raw asterisks", () => {
    const html = renderToStaticMarkup(
      <RichText text="You met **one** founder: Sarah Chen." />,
    );
    expect(html).toMatch(/<strong[^>]*>one<\/strong>/);
    expect(html).not.toContain("**one**");
  });

  it("handles italic, code, and lists", () => {
    const html = renderToStaticMarkup(
      <RichText
        text={"*Note* about `Loop`:\n\n- Sarah Chen\n- Tomás Silva\n\n1. first\n2. second"}
      />,
    );
    expect(html).toMatch(/<em>Note<\/em>/);
    expect(html).toMatch(/<code[^>]*>/);
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("Tomás Silva");
  });

  it("leaves unmatched markers alone instead of breaking", () => {
    const html = renderToStaticMarkup(<RichText text="a 5* rating and *半期" />);
    expect(html).toContain("5* rating");
  });

  it("escapes HTML — quoted memory text can never inject markup", () => {
    const html = renderToStaticMarkup(
      <RichText text={'<script>alert("x")</script> and <img src=x onerror=y>'} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders plain text unchanged", () => {
    const html = renderToStaticMarkup(
      <RichText text="Got it — saved to your memory of Sarah Chen." />,
    );
    expect(html).toContain("Got it — saved to your memory of Sarah Chen.");
  });
});

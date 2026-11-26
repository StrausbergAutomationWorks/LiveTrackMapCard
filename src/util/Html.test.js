import { describe, expect, it } from "@jest/globals";
import { attr, escapeHtml, unescapeHtml } from "./Html.js";

// LiveTrackMapCard#1 (backlog 368): text that reaches the page as markup is escaped, and read back exactly.
const HOSTILE = 'x" onmouseover="alert(1)" a=\'<img src=x onerror=alert(2)>&amp;&#39;';

describe("escapeHtml", () => {
  it("escapes the five characters that matter in content and in either quoted attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
  it("leaves no quote, angle bracket or bare ampersand", () => {
    expect(escapeHtml(HOSTILE)).not.toMatch(/["'<>]|&(?!amp;|lt;|gt;|quot;|#39;)/);
  });
  it("null and undefined are empty; numbers and others are their text", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(false)).toBe("false");
  });
});

describe("attr", () => {
  it("writes what a template literal writes, escaped: undefined stays the text undefined", () => {
    expect(attr(undefined)).toBe("undefined");
    expect(attr(null)).toBe("null");
    expect(attr(HOSTILE)).toBe(escapeHtml(HOSTILE));
  });
});

describe("unescapeHtml", () => {
  it("reads back exactly what was escaped", () => {
    for (const s of [HOSTILE, "", "plain", "a & b", "&amp;amp;", "日本 \u00e6\u00f8\u00e5 \u{1F6A2}", '{"action":"navigate","path":"/x\'y\\"z"}']) {
      expect(unescapeHtml(escapeHtml(s))).toBe(s);
    }
  });
  it("decodes the five named entities, apos, and numeric ones; leaves others alone", () => {
    expect(unescapeHtml("&lt;&gt;&quot;&#39;&apos;&amp;")).toBe("<>\"''&");
    expect(unescapeHtml("&#x41;&#66;&#X43;")).toBe("ABC");
    expect(unescapeHtml("&nbsp;&copy;&#xFFFFFFF;& b")).toBe("&nbsp;&copy;&#xFFFFFFF;& b");
  });
  it("decodes as the browser does an attribute value", () => {
    const div = document.createElement("div");
    div.innerHTML = `<i t="${escapeHtml(HOSTILE)}"></i>`;
    expect(div.querySelector("i").getAttribute("t")).toBe(HOSTILE);
    expect(unescapeHtml(escapeHtml(HOSTILE))).toBe(div.querySelector("i").getAttribute("t"));
  });
});

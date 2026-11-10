import { describe, expect, it } from "vitest";
import { ankiEscape, toAnki } from "../../lib/anki";

describe("ankiEscape", () => {
  it("escapes HTML metacharacters and tabs", () => {
    expect(ankiEscape('<b>"x"</b>\t&')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp;");
  });
});

describe("toAnki", () => {
  it("does not let API content break the export markup", () => {
    const out = toAnki([
      {
        word: "evil</title><script>alert(1)</script>",
        translation: '<img src=x onerror="alert(2)">',
        exampleEn: "line1\tline2",
        contexts: [{ context: "<b>ctx</b>" }],
      },
    ]);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img"); // 未转义的标签不得出现
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img src=x");
    expect(out).not.toContain("line1\tline2"); // tab would split the TSV row
  });

  it("keeps the intended markup structure for clean input", () => {
    const out = toAnki([{ word: "apple", translation: "苹果", phonetic: "ˈæpl" }]);
    expect(out).toContain("apple\t");
    expect(out).toContain("<i>ˈæpl</i>");
    expect(out).toContain("<div>苹果</div>");
  });
});

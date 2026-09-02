import { describe, expect, it } from "vitest";
import { renderBlockContainer } from "./block-structure.ts";

describe("Callout HTML block structure", () => {
  it("uses safe defaults when Callout presentation attributes are absent", () => {
    expect(
      renderBlockContainer(
        { type: "blockContainer", content: [{ type: "callout" }] },
        ["Body"],
      ),
    ).toBe(
      '<aside data-callout="" data-bg-color="gray" data-text-color="default"><span data-callout-icon="" aria-hidden="true">💡</span><div data-callout-content="">Body</div></aside>',
    );
  });

  it("uses the same defaults for empty Callout presentation attributes", () => {
    expect(
      renderBlockContainer(
        {
          type: "blockContainer",
          content: [
            {
              type: "callout",
              attrs: { icon: "", backgroundColor: "", textColor: "" },
            },
          ],
        },
        ["Body"],
      ),
    ).toContain(
      'data-bg-color="gray" data-text-color="default"><span data-callout-icon="" aria-hidden="true">💡</span>',
    );
  });
});

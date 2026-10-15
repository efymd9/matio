/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CandidateLink } from "./candidate-link";

// A job candidate's link in the admin (#376): clickable only for http(s), in
// a new tab with no opener, no referrer and `nofollow ugc` — everything else
// is inert text, whatever a row happens to hold.

afterEach(cleanup);

describe("CandidateLink", () => {
  it("an http(s) link is an anchor: new tab, no opener, no referrer, nofollow ugc", () => {
    const { container } = render(<CandidateLink value="https://vimeo.com/ana" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://vimeo.com/ana");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
    expect(a?.textContent).toBe("https://vimeo.com/ana");
  });

  it.each(["@ana.films", "javascript:alert(1)", "data:text/html,x", "vimeo.com/ana"])(
    "%s is plain text — no anchor",
    (value) => {
      const { container } = render(<CandidateLink value={value} />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toBe(value);
    },
  );
});

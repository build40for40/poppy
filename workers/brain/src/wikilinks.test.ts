import { describe, expect, it } from "vitest";
import { linkKind, parseWikilinks, resolveLink, wikilink } from "./wikilinks";

describe("parseWikilinks", () => {
  it("finds plain, labelled and heading links, once each, in order", () => {
    const body = ["Talked about [[topics/fake-thing]] and [[topics/other|another thing]].", "See [[sessions/2026-11-10-abc#Learned about them]] and [[topics/fake-thing.md]] again.", "Embedded ![[USER]]."].join("\n");
    expect(parseWikilinks(body)).toEqual(["topics/fake-thing.md", "topics/other.md", "sessions/2026-11-10-abc.md", "USER.md"]);
  });

  it("ignores empty, same-note and broken links", () => {
    expect(parseWikilinks("[[]] [[#Heading]] [[ ]] [[half [single] [[two\nlines]]")).toEqual([]);
  });

  it("returns nothing for a body without links", () => {
    expect(parseWikilinks("Just a chat.")).toEqual([]);
  });
});

describe("resolveLink, linkKind and wikilink", () => {
  it("adds .md unless the target already has an extension", () => {
    expect(resolveLink(" /sessions/abc ")).toBe("sessions/abc.md");
    expect(resolveLink("sessions/abc.md")).toBe("sessions/abc.md");
    expect(resolveLink("  ")).toBeNull();
  });

  it("takes a link's kind from the folder or file it points at", () => {
    expect(linkKind("sessions/abc.md")).toBe("session");
    expect(linkKind("USER.md")).toBe("user");
    expect(linkKind("MEMORY.md")).toBe("memory");
    expect(linkKind("somewhere/else.md")).toBe("note");
  });

  it("writes links without the extension", () => {
    expect(wikilink("sessions/abc.md")).toBe("[[sessions/abc]]");
    expect(wikilink("sessions/abc.md", "that chat")).toBe("[[sessions/abc|that chat]]");
  });
});

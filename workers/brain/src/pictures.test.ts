import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_PATH } from "./http";
import { checkBody, PICTURE_ID, renderPng, slug } from "./pictures";
import { DRAWING_PROMPT, MAX_DRAWINGS_PER_DAY, SHELF_NAME, type PictureShelf } from "./shelf";
import { STARTER_PICTURES } from "./starter-pictures";
import { mockClaude } from "./testing";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const shelfStub = () => env.PICTURE_SHELF.get(env.PICTURE_SHELF.idFromName(SHELF_NAME));
const inShelf = <T>(run: (shelf: PictureShelf, state: DurableObjectState) => T | Promise<T>) => runInDurableObject(shelfStub(), (instance, state) => run(instance as unknown as PictureShelf, state));
const fetchPicture = (id: string, method = "GET") => exports.default.fetch(new Request(`https://example.com${BASE_PATH}/pictures/${id}.png`, { method }));
const drawing = (body = '<rect x="100" y="100" width="200" height="120" rx="10" fill="#D85A30"/>', scene = "indoor") => ({
  content: [{ type: "text" as const, text: JSON.stringify({ about: "A fake picture", scene, body }) }],
});

let fresh = 0;
const activity = () => `Fake activity ${++fresh} ${crypto.randomUUID().slice(0, 6)}`;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the starter set", () => {
  it("has thirty pictures with unique ids that work in a URL", () => {
    expect(STARTER_PICTURES).toHaveLength(30);
    expect(new Set(STARTER_PICTURES.map((p) => p.id)).size).toBe(30);
    for (const picture of STARTER_PICTURES) expect(picture.id).toMatch(PICTURE_ID);
  });

  it("only uses shapes a drawn picture would be allowed, and every one draws", async () => {
    for (const picture of STARTER_PICTURES) {
      expect(checkBody(picture.body), picture.id).toEqual({ body: picture.body });
      expect([...(await renderPng(picture)).slice(0, 4)], picture.id).toEqual(PNG_SIGNATURE);
    }
  });

  it("shows the drawing model examples from the set", () => {
    expect(DRAWING_PROMPT).toContain("## toy-bath");
  });
});

describe("checkBody", () => {
  it("lets plain shapes through", () => {
    expect(checkBody(' <g transform="rotate(10 50 50)"><circle cx="50" cy="50" r="20" fill="#378ADD"/></g> ')).toEqual({ body: '<g transform="rotate(10 50 50)"><circle cx="50" cy="50" r="20" fill="#378ADD"/></g>' });
    const line = '<line x1="200" y1="156" x2="300" y2="156" stroke="#378ADD" stroke-width="4"/>';
    expect(checkBody(line)).toEqual({ body: line });
  });

  it("refuses text, scripts, links, images, styles, references and anything outside a tag", () => {
    for (const body of [
      "",
      "<text>Hi</text>",
      "<script>alert(1)</script>",
      '<image href="https://example.com/x.png"/>',
      '<rect onclick="x()" width="1" height="1"/>',
      '<rect style="fill:red" width="1" height="1"/>',
      '<rect fill="url(#a)" width="1" height="1"/>',
      '<a href="https://example.com"><rect width="1" height="1"/></a>',
      "<!ENTITY x>",
      '<rect width="1" height="1"/> hello',
      '<rect width="1" height="1" fill=red/>',
    ]) {
      expect(checkBody(body), body).toHaveProperty("error");
    }
  });
});

describe("slug", () => {
  it("turns an activity name into an id", () => {
    expect(slug("Dino swamp!")).toBe("dino-swamp");
    expect(slug("  --Cars & Ramps 2--")).toBe("cars-ramps-2");
    expect(slug("x".repeat(80))).toHaveLength(48);
  });
});

describe("the pictures route", () => {
  it("serves a starter picture as a PNG", async () => {
    const response = await fetchPicture("toy-bath");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]).toEqual(PNG_SIGNATURE);
    expect((await fetchPicture("toy-bath", "HEAD")).status).toBe(200);
  });

  it("answers 404 for a picture that doesn't exist or a bad name, and only takes GET and HEAD", async () => {
    expect((await fetchPicture("no-such-picture")).status).toBe(404);
    expect((await fetchPicture("Bad_Name")).status).toBe(404);
    expect((await exports.default.fetch(new Request(`https://example.com${BASE_PATH}/pictures/toy-bath.svg`))).status).toBe(404);
    expect((await fetchPicture("toy-bath", "POST")).status).toBe(405);
  });
});

describe("the picture shelf", () => {
  it("draws a wanted picture on its alarm, keeps it and serves it", async () => {
    const claude = mockClaude(drawing());
    const name = activity();
    expect(await inShelf((shelf) => shelf.want({ activity: name, brief: "  a fake   thing " }))).toBe("queued");
    await runDurableObjectAlarm(shelfStub());

    expect(claude.requests[0].model).toBe("claude-opus-5-5");
    expect(claude.requests[0].messages[0].content).toBe(`Activity: ${name}\nWhat to draw: a fake thing`);
    expect(await inShelf((shelf) => shelf.list())).toContainEqual({ id: slug(name), about: "A fake picture" });
    const response = await fetchPicture(slug(name));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("doesn't ask twice for a picture it has or is waiting on, or for one in the starter set", async () => {
    mockClaude();
    const name = activity();
    expect(await inShelf((shelf) => shelf.want({ activity: name, brief: "a fake thing" }))).toBe("queued");
    expect(await inShelf((shelf) => shelf.want({ activity: name, brief: "a fake thing" }))).toBe("exists");
    expect(await inShelf((shelf) => shelf.want({ activity: "Toy bath", brief: "toys in a bath" }))).toBe("exists");
    await inShelf((_, state) => void state.storage.sql.exec("DELETE FROM wanted"));
  });

  it("throws away a drawing that isn't plain shapes, and gives up after a few tries", async () => {
    const claude = mockClaude(drawing("<text>Hi</text>"), drawing("<script>x</script>"), drawing('<image href="x"/>'));
    const name = activity();
    await inShelf((shelf) => shelf.want({ activity: name, brief: "a fake thing" }));
    for (let attempt = 0; attempt < 3; attempt++) {
      await inShelf((_, state) => void state.storage.sql.exec("UPDATE wanted SET after = ?", new Date(0).toISOString()));
      await runDurableObjectAlarm(shelfStub());
    }
    expect(claude.requests).toHaveLength(3);
    expect(await inShelf((shelf) => shelf.get(slug(name)))).toBeNull();
    expect(await inShelf((_, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM wanted WHERE id = ?", slug(name)).one().n)).toBe(0);
  });

  it("stops drawing for the day at the daily limit", async () => {
    const claude = mockClaude();
    await inShelf((_, state) => {
      const now = new Date().toISOString();
      for (let i = 0; i < MAX_DRAWINGS_PER_DAY; i++) state.storage.sql.exec("INSERT OR IGNORE INTO pictures (id, about, scene, body, activity, created_at) VALUES (?, 'x', 'indoor', '<rect/>', 'x', ?)", `fake-limit-${i}`, now);
    });
    await inShelf((shelf) => shelf.want({ activity: activity(), brief: "a fake thing" }));
    await runDurableObjectAlarm(shelfStub());
    expect(claude.requests).toHaveLength(0);
    await inShelf((_, state) => {
      state.storage.sql.exec("DELETE FROM pictures WHERE id LIKE 'fake-limit-%'");
      state.storage.sql.exec("DELETE FROM wanted");
    });
  });

  it("deletes a drawn picture the team doesn't want", async () => {
    await inShelf((_, state) => void state.storage.sql.exec("INSERT INTO pictures (id, about, scene, body, activity, created_at) VALUES ('fake-bad', 'x', 'indoor', '<rect/>', 'x', ?)", new Date().toISOString()));
    expect(await inShelf((shelf) => shelf.remove("fake-bad"))).toBe(true);
    expect(await inShelf((shelf) => shelf.get("fake-bad"))).toBeNull();
  });
});

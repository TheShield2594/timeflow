import { describe, it, expect } from "vitest";
import { byId, indexById } from "./entityIndex";

const records = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];

describe("indexById", () => {
  it("indexes every record by its id", () => {
    const index = indexById(records);
    expect(index.get("a")).toBe(records[0]);
    expect(index.get("b")).toBe(records[1]);
    expect(index.size).toBe(2);
  });

  it("misses on an unknown id rather than throwing", () => {
    expect(indexById(records).get("nope")).toBeUndefined();
  });

  it("handles an empty list", () => {
    expect(indexById([]).size).toBe(0);
  });

  // Duplicate ids shouldn't happen, but if the backend ever returns one the
  // index has to agree with the `.find()` it replaced — which keeps the first.
  it("keeps the first record when ids repeat", () => {
    const dupes = [{ id: "a", name: "First" }, { id: "a", name: "Second" }];
    expect(indexById(dupes).get("a")).toBe(dupes[0]);
  });
});

describe("byId", () => {
  it("looks a record up by id", () => {
    expect(byId(indexById(records), "b")).toBe(records[1]);
  });

  it("returns undefined for a missing id — an entry with no task is normal", () => {
    const index = indexById(records);
    expect(byId(index, undefined)).toBeUndefined();
    expect(byId(index, null)).toBeUndefined();
    expect(byId(index, "")).toBeUndefined();
  });
});

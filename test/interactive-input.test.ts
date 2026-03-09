import test from "node:test";
import assert from "node:assert/strict";
import { promptObjectBySchema } from "../src/core/interactive-input.js";

function promptFrom(values: string[]) {
  let index = 0;
  return async () => values[index++] ?? "";
}

test("interactive schema prompt supports nested objects and arrays", async () => {
  const result = await promptObjectBySchema(
    promptFrom([
      "Launch title",
      "2",
      "tag-one",
      "tag-two",
      "yes",
      "true",
      "3"
    ]),
    "publish",
    {
      type: "object",
      required: ["title", "tags"],
      properties: {
        title: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" }
        },
        metadata: {
          type: "object",
          properties: {
            featured: { type: "boolean" },
            priority: { type: "integer" }
          }
        }
      }
    }
  );

  assert.deepEqual(result, {
    title: "Launch title",
    tags: ["tag-one", "tag-two"],
    metadata: {
      featured: true,
      priority: 3
    }
  });
});

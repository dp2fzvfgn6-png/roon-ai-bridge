const assert = require("node:assert/strict");
const test = require("node:test");

const { downloadToolImage } = require("../dist/services/toolFileService");
const { sanitizeValue } = require("../dist/services/sanitization");

test("downloads an authorized HTTPS image file with bounded bytes", async () => {
  const calls = [];
  const result = await downloadToolImage({
    download_url: "https://files.example.test/cover.png?signature=temporary",
    file_id: "file_cover",
    mime_type: "image/png",
    file_name: "cover.png"
  }, {
    maximumBytes: 1024,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(Buffer.from("png-bytes"), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "9" }
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "follow");
  assert.equal(result.bytes.toString(), "png-bytes");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.fileId, "file_cover");
  assert.equal(result.fileName, "cover.png");
});

test("rejects non-HTTPS and private authorized file URLs", async () => {
  for (const downloadUrl of [
    "http://files.example.test/cover.png",
    "https://localhost/cover.png",
    "https://127.0.0.1/cover.png",
    "https://192.168.1.10/cover.png",
    "https://[::1]/cover.png"
  ]) {
    await assert.rejects(
      () => downloadToolImage({ download_url: downloadUrl, file_id: "file_cover" }, {
        maximumBytes: 1024,
        fetchImpl: async () => { throw new Error("fetch should not run"); }
      }),
      (error) => error.code === "INVALID_PLAYLIST_COVER" && /public HTTPS/.test(error.message)
    );
  }
});

test("stops reading an authorized file when the byte limit is exceeded", async () => {
  await assert.rejects(
    () => downloadToolImage({
      download_url: "https://files.example.test/large.webp",
      file_id: "file_large",
      mime_type: "image/webp"
    }, {
      maximumBytes: 5,
      fetchImpl: async () => new Response(Buffer.from("too-large"), {
        status: 200,
        headers: { "content-type": "image/webp" }
      })
    }),
    (error) => error.code === "INVALID_PLAYLIST_COVER" && error.details.maximum_bytes === 5
  );
});

test("rejects unsupported file MIME types before image decoding", async () => {
  await assert.rejects(
    () => downloadToolImage({
      download_url: "https://files.example.test/cover.gif",
      file_id: "file_gif",
      mime_type: "image/gif"
    }, {
      maximumBytes: 1024,
      fetchImpl: async () => new Response(Buffer.from("gif"), {
        status: 200,
        headers: { "content-type": "image/gif" }
      })
    }),
    (error) => error.code === "INVALID_PLAYLIST_COVER" && /JPEG, PNG or WebP/.test(error.message)
  );
});

test("redacts temporary authorized download URLs from audit payloads", () => {
  const sanitized = sanitizeValue({
    image_file: {
      download_url: "https://files.example.test/cover.png?signature=secret",
      file_id: "file_cover",
      mime_type: "image/png"
    }
  });

  assert.equal(sanitized.image_file.download_url, "[REDACTED]");
  assert.equal(sanitized.image_file.file_id, "file_cover");
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AvatarUploadError, processAvatarUpload } from "../src/avatar";

const temporaryDirectories: string[] = [];

async function temporaryAvatarDir() {
  const directory = await mkdtemp(join(tmpdir(), "profile-avatar-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("processAvatarUpload", () => {
  test("normalizes a supported image to a square WebP", async () => {
    const avatarDir = await temporaryAvatarDir();
    const input = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 91, g: 92, b: 226 },
      },
    })
      .jpeg()
      .toBuffer();
    const file = new File([input], "avatar.jpg", { type: "image/jpeg" });

    const filename = await processAvatarUpload(file, {
      avatarDir,
      maxUploadBytes: 5 * 1024 * 1024,
      subject: "user-123",
      version: "c102e5d4-8f36-4e16-a647-d1617e0f686b",
    });
    const metadata = await sharp(join(avatarDir, filename)).metadata();

    expect(filename).toMatch(/^[a-f0-9]{40}-c102e5d4-8f36-4e16-a647-d1617e0f686b\.webp$/);
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  test("rejects unsupported, empty, oversized, and corrupt inputs", async () => {
    const avatarDir = await temporaryAvatarDir();
    const options = {
      avatarDir,
      maxUploadBytes: 10,
      subject: "user-123",
      version: crypto.randomUUID(),
    };

    await expect(
      processAvatarUpload(new File(["content"], "avatar.gif", { type: "image/gif" }), options),
    ).rejects.toBeInstanceOf(AvatarUploadError);
    await expect(
      processAvatarUpload(new File([], "avatar.png", { type: "image/png" }), options),
    ).rejects.toThrow("Choose an image to upload");
    await expect(
      processAvatarUpload(
        new File(["content larger than ten bytes"], "avatar.png", { type: "image/png" }),
        options,
      ),
    ).rejects.toThrow("smaller than 0 MB");
    await expect(
      processAvatarUpload(new File(["not-image"], "avatar.png", { type: "image/png" }), options),
    ).rejects.toThrow("could not be read as a safe image");
    await expect(
      processAvatarUpload(
        new File(
          ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'],
          "avatar.png",
          { type: "image/png" },
        ),
        { ...options, maxUploadBytes: 1024 },
      ),
    ).rejects.toThrow("Use a JPEG, PNG, WebP, or AVIF image");
  });
});

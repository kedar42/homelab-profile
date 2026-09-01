import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { hashToken } from "./security";

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export class AvatarUploadError extends Error {}

export async function avatarFilename(subject: string): Promise<string> {
  return `${(await hashToken(subject)).slice(0, 40)}.webp`;
}

export async function processAvatarUpload(
  file: File,
  options: { avatarDir: string; maxUploadBytes: number; subject: string; version: string },
): Promise<string> {
  if (file.size === 0) throw new AvatarUploadError("Choose an image to upload.");
  if (file.size > options.maxUploadBytes) {
    throw new AvatarUploadError(
      `The image must be smaller than ${Math.floor(options.maxUploadBytes / 1024 / 1024)} MB.`,
    );
  }
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new AvatarUploadError("Use a JPEG, PNG, WebP, or AVIF image.");
  }

  const input = Buffer.from(await file.arrayBuffer());
  let output: Buffer;
  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: 24_000_000,
    });
    const metadata = await image.metadata();
    if (!metadata.mediaType || !ACCEPTED_IMAGE_TYPES.has(metadata.mediaType)) {
      throw new AvatarUploadError("Use a JPEG, PNG, WebP, or AVIF image.");
    }
    if (metadata.mediaType !== file.type) {
      throw new AvatarUploadError("The image content does not match its declared file type.");
    }
    output = await image
      .rotate()
      .resize(512, 512, {
        fit: "cover",
        position: "attention",
        withoutEnlargement: false,
      })
      .webp({ quality: 88, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof AvatarUploadError) throw error;
    throw new AvatarUploadError("That file could not be read as a safe image.");
  }

  await mkdir(options.avatarDir, { recursive: true });
  const filename = `${(await avatarFilename(options.subject)).replace(".webp", "")}-${options.version}.webp`;
  const destination = join(options.avatarDir, filename);
  const temporary = join(options.avatarDir, `.${filename}.${crypto.randomUUID()}.tmp`);

  try {
    await Bun.write(temporary, output);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  return filename;
}

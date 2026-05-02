#!/usr/bin/env node
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

config();

const REPO_ROOT = process.cwd();
const WEB_DIR = path.join(REPO_ROOT, "web");
const MEDIA_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".mp4",
  ".png",
  ".svg",
  ".webm",
  ".webp",
]);
const MIME_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};
const CACHE_CONTROL =
  process.env.R2_CACHE_CONTROL || "public, max-age=31536000, immutable";

const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has("--check") || args.has("--dry-run");
const forceUpload = args.has("--force");

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createClient() {
  const accountId = getEnv("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function listMediaFiles(dirPath, relativeBase = "") {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.join(relativeBase, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listMediaFiles(absolutePath, relativePath)));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(extension)) {
      continue;
    }

    files.push({
      absolutePath,
      relativePath: relativePath.split(path.sep).join("/"),
      extension,
    });
  }

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function inspectRemoteObject(client, bucket, key) {
  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return {
      exists: true,
      size: response.ContentLength ?? null,
      checksum: response.Metadata?.sha256 ?? null,
      cacheControl: response.CacheControl ?? null,
    };
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    if (
      statusCode === 404 ||
      error?.name === "NotFound" ||
      error?.Code === "NotFound"
    ) {
      return { exists: false };
    }
    throw error;
  }
}

function shouldUpload(remote, localSize, localChecksum) {
  if (!remote.exists) {
    return { upload: true, reason: "missing" };
  }

  if (forceUpload) {
    return { upload: true, reason: "forced" };
  }

  if (remote.checksum && remote.checksum !== localChecksum) {
    return { upload: true, reason: "checksum-changed" };
  }

  if (remote.size !== null && remote.size !== localSize) {
    return { upload: true, reason: "size-changed" };
  }

  if (remote.cacheControl !== CACHE_CONTROL) {
    return { upload: true, reason: "cache-control-changed" };
  }

  return { upload: false, reason: "up-to-date" };
}

async function main() {
  const bucket = getEnv("R2_BUCKET");
  const keyPrefix = (process.env.R2_WEB_PREFIX || "web").replace(
    /^\/+|\/+$/g,
    "",
  );
  const client = createClient();

  const files = await listMediaFiles(WEB_DIR);
  if (files.length === 0) {
    console.log("No media files found in web/.");
    return;
  }

  let uploaded = 0;
  let skipped = 0;

  for (const file of files) {
    const fileStats = await stat(file.absolutePath);
    const checksum = await sha256File(file.absolutePath);
    const key = `${keyPrefix}/${file.relativePath}`;
    const remote = await inspectRemoteObject(client, bucket, key);
    const decision = shouldUpload(remote, fileStats.size, checksum);

    if (!decision.upload) {
      skipped += 1;
      console.log(`skip  ${key} (${decision.reason})`);
      continue;
    }

    console.log(
      `${isCheckOnly ? "would " : ""}upload ${key} (${decision.reason})`,
    );

    if (isCheckOnly) {
      uploaded += 1;
      continue;
    }

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(file.absolutePath),
        ContentType: MIME_TYPES[file.extension] || "application/octet-stream",
        CacheControl: CACHE_CONTROL,
        Metadata: {
          sha256: checksum,
        },
      }),
    );

    uploaded += 1;
  }

  console.log("");
  console.log(`Processed ${files.length} local media files.`);
  console.log(
    `${isCheckOnly ? "Would upload" : "Uploaded"} ${uploaded} file(s).`,
  );
  console.log(`Skipped ${skipped} file(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

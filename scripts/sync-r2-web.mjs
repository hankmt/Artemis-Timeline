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
const AUDIO_DIR = path.join(REPO_ROOT, "audio");
const WEB_EXTENSIONS = new Set([
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
const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);
const MIME_TYPES = {
  ".aac": "audio/aac",
  ".avif": "image/avif",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};
const CACHE_CONTROL =
  process.env.R2_CACHE_CONTROL || "public, max-age=31536000, immutable";
const CONCURRENCY = Math.max(
  1,
  Number.parseInt(
    process.env.R2_UPLOAD_CONCURRENCY || process.env.R2_WEB_CONCURRENCY || "8",
    10,
  ) || 8,
);

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

async function listMediaFiles(target, dirPath, relativeBase = "") {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.join(relativeBase, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listMediaFiles(target, absolutePath, relativePath)));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!target.extensions.has(extension)) {
      continue;
    }

    files.push({
      absolutePath,
      key: `${target.keyPrefix}/${relativePath.split(path.sep).join("/")}`,
      relativePath: relativePath.split(path.sep).join("/"),
      extension,
      sourceLabel: target.label,
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

async function processFile({ client, bucket, file }) {
  const fileStats = await stat(file.absolutePath);
  const checksum = await sha256File(file.absolutePath);
  const key = file.key;
  const remote = await inspectRemoteObject(client, bucket, key);
  const decision = shouldUpload(remote, fileStats.size, checksum);

  if (!decision.upload) {
    console.log(`skip  ${key} (${decision.reason})`);
    return { uploaded: 0, skipped: 1 };
  }

  console.log(
    `${isCheckOnly ? "would " : ""}upload ${key} (${decision.reason})`,
  );

  if (isCheckOnly) {
    return { uploaded: 1, skipped: 0 };
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

  return { uploaded: 1, skipped: 0 };
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

async function main() {
  const bucket = getEnv("R2_BUCKET");
  const client = createClient();
  const targets = [
    {
      label: "web",
      dirPath: WEB_DIR,
      extensions: WEB_EXTENSIONS,
      keyPrefix: (process.env.R2_WEB_PREFIX || "web").replace(/^\/+|\/+$/g, ""),
    },
    {
      label: "audio",
      dirPath: AUDIO_DIR,
      extensions: AUDIO_EXTENSIONS,
      keyPrefix: (process.env.R2_AUDIO_PREFIX || "audio").replace(
        /^\/+|\/+$/g,
        "",
      ),
    },
  ];

  const filesPerTarget = await Promise.all(
    targets.map(async (target) => ({
      label: target.label,
      files: await listMediaFiles(target, target.dirPath),
    })),
  );
  const files = filesPerTarget.flatMap((entry) => entry.files);

  if (files.length === 0) {
    console.log("No media files found in web/ or audio/.");
    return;
  }

  for (const entry of filesPerTarget) {
    console.log(`Found ${entry.files.length} ${entry.label} file(s).`);
  }
  console.log("");

  const results = await runWithConcurrency(
    files,
    (file) => processFile({ client, bucket, file }),
    CONCURRENCY,
  );
  const uploaded = results.reduce((sum, result) => sum + result.uploaded, 0);
  const skipped = results.reduce((sum, result) => sum + result.skipped, 0);

  console.log("");
  console.log(`Processed ${files.length} local web/audio file(s).`);
  console.log(
    `${isCheckOnly ? "Would upload" : "Uploaded"} ${uploaded} file(s).`,
  );
  console.log(`Skipped ${skipped} file(s).`);
  console.log(`Used concurrency ${CONCURRENCY}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

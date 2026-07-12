#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const LUMA_API_URL = "https://public-api.luma.com/v1/calendars/events/list";
const POSTS_DIR = path.resolve(__dirname, "..", "_posts");

function parseArgs(argv) {
  const args = {
    write: false,
    after: new Date().toISOString(),
    afterProvided: false,
    limit: 100,
    includePast: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--write") {
      args.write = true;
      continue;
    }

    if (arg === "--dry-run") {
      args.write = false;
      continue;
    }

    if (arg.startsWith("--after=")) {
      args.after = arg.slice("--after=".length);
      args.afterProvided = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = parsed;
      }
      continue;
    }

    if (arg === "--include-past") {
      args.includePast = true;
    }
  }

  return args;
}

function printHelp() {
  console.log("Usage: node scripts/fetch-luma-events.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --write               Persist file changes to _posts");
  console.log("  --dry-run             Show planned changes without writing files (default)");
  console.log("  --after=<iso-date>    Fetch events starting after this UTC timestamp");
  console.log("  --limit=<number>      Events per API page (default: 100)");
  console.log("  --include-past        Legacy alias; past events are included when --after is provided");
  console.log("  --help, -h            Show this help message");
}

function toIdToken(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function formatDateForPost(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return {
    dateOnly: `${year}-${month}-${day}`,
    timestamp: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
  };
}

function yamlValue(value) {
  const raw = value == null ? "" : String(value);
  return `'${raw.replace(/'/g, "''")}'`;
}

function toFrontmatter(post) {
  return [
    "---",
    `title: ${yamlValue(post.title)}`,
    `date: ${post.date}`,
    `image: ${yamlValue(post.image)}`,
    `registration: ${yamlValue(post.registration)}`,
    "---",
    "",
  ].join("\n");
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function normalizeEvent(rawEvent) {
  const title = pickFirstNonEmpty([
    rawEvent.name,
    rawEvent.title,
    rawEvent.event?.name,
    rawEvent.event?.title,
  ]);

  const startAt = pickFirstNonEmpty([
    rawEvent.start_at,
    rawEvent.startAt,
    rawEvent.event?.start_at,
    rawEvent.event?.startAt,
  ]);

  const image = pickFirstNonEmpty([
    rawEvent.cover_url,
    rawEvent.cover?.url,
    rawEvent.image_url,
    rawEvent.image?.url,
    rawEvent.event?.cover_url,
    rawEvent.event?.image_url,
  ]);

  const registration = pickFirstNonEmpty([
    rawEvent.url,
    rawEvent.registration_url,
    rawEvent.event_url,
    rawEvent.public_url,
    rawEvent.event?.url,
    rawEvent.event?.registration_url,
  ]);

  const id = pickFirstNonEmpty([
    rawEvent.api_id,
    rawEvent.event_api_id,
    rawEvent.id,
    rawEvent.event?.api_id,
    rawEvent.event?.id,
  ]);

  return { id, title, startAt, image, registration, rawEvent };
}

async function fetchAllApprovedEvents({ apiKey, after, limit }) {
  const events = [];
  let cursor = null;

  do {
    const params = new URLSearchParams();
    params.set("status", "approved");
    params.set("after", after);
    params.set("sort_column", "start_at");
    params.set("sort_direction", "asc");
    params.set("pagination_limit", String(limit));

    if (cursor) {
      params.set("pagination_cursor", cursor);
    }

    const response = await fetch(`${LUMA_API_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-luma-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Luma API request failed: ${response.status} ${response.statusText} - ${body}`,
      );
    }

    const payload = await response.json();
    const pageEvents = payload.entries || payload.events || payload.items || [];

    if (!Array.isArray(pageEvents)) {
      throw new Error("Unexpected Luma response: expected events array.");
    }

    events.push(...pageEvents);
    cursor = payload.next_cursor || payload.pagination?.next_cursor || null;
  } while (cursor);

  return events;
}

async function listPostFiles() {
  const names = await fs.readdir(POSTS_DIR);
  return names.filter((name) => name.endsWith(".md"));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.LUMA_API_KEY || process.env.MEETUP_API_KEY;

  if (!apiKey) {
    throw new Error("Missing LUMA_API_KEY or MEETUP_API_KEY environment variable.");
  }

  const now = new Date();
  const rawEvents = await fetchAllApprovedEvents({
    apiKey,
    after: args.after,
    limit: args.limit,
  });

  const postFiles = await listPostFiles();

  const summary = {
    fetched: rawEvents.length,
    eligible: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    unchanged: 0,
  };

  for (const rawEvent of rawEvents) {
    const event = normalizeEvent(rawEvent);

    if (!event.id || !event.title || !event.startAt || !event.registration) {
      summary.skipped += 1;
      continue;
    }

    const starts = new Date(event.startAt);
    if (Number.isNaN(starts.getTime())) {
      summary.skipped += 1;
      continue;
    }

    if (!args.afterProvided && starts <= now) {
      summary.skipped += 1;
      continue;
    }

    const dateInfo = formatDateForPost(starts.toISOString());
    if (!dateInfo) {
      summary.skipped += 1;
      continue;
    }

    summary.eligible += 1;

    const idToken = toIdToken(event.id);
    const suffix = `-luma-${idToken}.md`;
    const existingName = postFiles.find((name) => name.endsWith(suffix));
    const preferredName = `${dateInfo.dateOnly}-${slugify(event.title) || "event"}${suffix}`;
    const fileName = existingName || preferredName;

    const post = {
      title: event.title,
      date: dateInfo.timestamp,
      image: event.image,
      registration: event.registration,
    };

    const nextContent = toFrontmatter(post);
    const targetPath = path.join(POSTS_DIR, fileName);

    let previousContent = null;
    try {
      previousContent = await fs.readFile(targetPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const isCreate = previousContent == null;
    if (previousContent === nextContent) {
      summary.unchanged += 1;
      continue;
    }

    if (args.write) {
      await fs.writeFile(targetPath, nextContent, "utf8");
    }

    if (isCreate) {
      summary.created += 1;
      if (!postFiles.includes(fileName)) {
        postFiles.push(fileName);
      }
    } else {
      summary.updated += 1;
    }

    const action = isCreate ? "CREATE" : "UPDATE";
    const mode = args.write ? "write" : "dry-run";
    console.log(`[${mode}] ${action} ${fileName}`);
  }

  console.log("\nLuma import summary");
  console.log(`- fetched: ${summary.fetched}`);
  console.log(`- eligible: ${summary.eligible}`);
  console.log(`- created: ${summary.created}`);
  console.log(`- updated: ${summary.updated}`);
  console.log(`- unchanged: ${summary.unchanged}`);
  console.log(`- skipped: ${summary.skipped}`);

  if (!args.write) {
    console.log("\nDry run only. Re-run with --write to persist changes.");
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

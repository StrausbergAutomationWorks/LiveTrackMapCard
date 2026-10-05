// Release gate, run after `npm run build`:
//     node build/check-release.mjs [tag]
// Refuses to pass a bundle that should not be published - see
// releaseProblems() in stamp-version.js - and writes the bundle's SHA-256
// beside it for the release.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";
import { parseBanner, readGit, releaseProblems } from "./stamp-version.js";
import { BUNDLED, missingNotices, readNotice } from "./notices.js";

const FILE = "dist/live-track-map-card.js";
const tag = process.argv[2] ?? "";

const bundle = readFileSync(FILE);
const { version: packageVersion } = JSON.parse(readFileSync("package.json", "utf8"));
const git = readGit(process.cwd());
const bannerVersion = parseBanner(bundle.toString("utf8"));

const problems = releaseProblems({ packageVersion, git, bannerVersion, tag });
// Backlog 272: every bundled package's licence notice must be in the file.
problems.push(...missingNotices(bundle.toString("utf8"), BUNDLED.map((n) => readNotice(process.cwd(), n))));
if (problems.length) {
  for (const p of problems) console.error(`RELEASE CHECK FAILED: ${p}`);
  process.exit(1);
}

const sha = createHash("sha256").update(bundle).digest("hex");
writeFileSync(`${FILE}.sha256`, `${sha}  live-track-map-card.js\n`);
console.log(`release check passed: ${bannerVersion}${tag ? ` for ${tag}` : ""}; sha256 ${sha}`);

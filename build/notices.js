// Third-party licence notices INSIDE the bundle (backlog 272, 2026-10-05).
//
// HACS hands users dist/live-track-map-card.js and nothing else, so the
// notices Leaflet (BSD-2-Clause), leaflet.markercluster (MIT), lit
// (BSD-3-Clause) and the path-following packages ask to travel with copies
// must be IN that file. Each text is read verbatim from the package as
// installed and written into one preserved /*! ... */ comment after the
// version banner. THIRD_PARTY_NOTICES.md carries the same texts for readers.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every package the bundle carries, by node_modules name. */
export const BUNDLED = [
  "leaflet",
  "leaflet.markercluster",
  "lit",
  "lit-html",
  "lit-element",
  "@lit/reactive-element",
  "@mapbox/vector-tile",
  "pbf",
  "@mapbox/point-geometry",
];

/** The first line of the banner; check-release looks for it. */
export const NOTICES_HEAD = "Third-party notices for the packages bundled in this file:";

/**
 * One package's name, version, licence id and licence text, read from
 * node_modules. Throws when the licence file is missing: a build must not
 * quietly ship without a notice.
 * @param {string} root the repository root
 * @param {string} name the package name
 * @returns {{name: string, version: string, license: string, text: string}}
 */
export function readNotice(root, name) {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^(LICEN[CS]E|MIT-LICEN[CS]E)/i.test(f));
  if (!file) throw new Error(`no licence file in ${name}`);
  return { name, version: pkg.version, license: pkg.license, text: readFileSync(join(dir, file), "utf8").trim() };
}

/**
 * The preserved comment carrying every notice. A literal end-of-comment
 * inside a licence text would cut the comment short, so it is broken up.
 * @param {Array<{name: string, version: string, license: string, text: string}>} notices
 * @returns {string}
 */
export function noticesBanner(notices) {
  const lines = ["/*!", ` * ${NOTICES_HEAD}`];
  for (const n of notices) {
    lines.push(" *", ` * ---- ${n.name} ${n.version} (${n.license}) ----`, " *");
    for (const l of n.text.replace(/\r\n/g, "\n").split("\n")) {
      lines.push((" * " + l.replace(/\*\//g, "* /")).trimEnd());
    }
  }
  lines.push(" */");
  return lines.join("\n");
}

/**
 * The notices a bundle text is missing: every package must appear with its
 * name, version and the first line of its licence text.
 * @param {string} bundle the bundle's text
 * @param {Array<{name: string, version: string, license: string, text: string}>} notices
 * @returns {string[]} one message per missing notice; empty when complete
 */
export function missingNotices(bundle, notices) {
  const out = [];
  if (!bundle.includes(NOTICES_HEAD)) out.push("no third-party notices block");
  for (const n of notices) {
    const first = n.text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
    if (!bundle.includes(`---- ${n.name} ${n.version} (${n.license}) ----`) || (first && !bundle.includes(first))) {
      out.push(`notice missing for ${n.name} ${n.version}`);
    }
  }
  return out;
}

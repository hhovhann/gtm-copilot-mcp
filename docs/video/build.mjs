#!/usr/bin/env node
// Builds the demo video pieces from script.md and slides.template.html.
//   node docs/video/build.mjs audio    synthesize narration with macOS `say`, measure each slide
//   node docs/video/build.mjs slides   inject captures, render one PNG per slide with headless Chrome
// Needs macOS (`say`), ffmpeg/ffprobe and Google Chrome. Output goes to docs/video/out/ (git-ignored).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const VOICE = process.env.VIDEO_VOICE || "Samantha";
const RATE = process.env.VIDEO_RATE || "170"; // words per minute
const GAP = 0.7; // seconds of silence after each slide

export function parseScript() {
  const md = readFileSync(join(here, "script.md"), "utf8");
  const slides = [];
  for (const block of md.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split("\n");
    const m = /^(\d+)\.\s+(.*)$/.exec(head.trim());
    if (!m) continue;
    const text = rest.filter((l) => l.startsWith("> ")).map((l) => l.slice(2).trim()).join(" ");
    const onScreen = (rest.find((l) => l.startsWith("**On screen:**")) || "").replace("**On screen:**", "").trim();
    slides.push({ n: Number(m[1]), title: m[2], text, onScreen });
  }
  return slides;
}

export function speechText(text) {
  const map = JSON.parse(readFileSync(join(here, "pronunciations.json"), "utf8"));
  let t = text;
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith("_")) continue;
    t = t.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  }
  return t;
}

const pad = (n) => String(n).padStart(2, "0");
const probe = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());

function audio() {
  const slides = parseScript();
  const report = [];
  for (const s of slides) {
    const aiff = join(out, `${pad(s.n)}.aiff`);
    const m4a = join(out, `${pad(s.n)}.m4a`);
    execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", aiff, "--", speechText(s.text)]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k", m4a]);
    const seconds = probe(m4a);
    report.push({ n: s.n, title: s.title, words: s.text.split(/\s+/).length, seconds: Number(seconds.toFixed(2)) });
  }
  const speech = report.reduce((a, r) => a + r.seconds, 0);
  const total = speech + GAP * report.length;
  writeFileSync(join(out, "durations.json"), JSON.stringify({ voice: VOICE, rate: RATE, gap: GAP, slides: report, speechSeconds: speech, totalSeconds: total }, null, 2));
  for (const r of report) console.log(`${pad(r.n)} ${r.title.padEnd(40)} ${String(r.words).padStart(3)} words ${r.seconds.toFixed(1).padStart(5)} s`);
  console.log(`speech ${speech.toFixed(1)} s, with ${GAP}s gaps ${total.toFixed(1)} s = ${Math.floor(total / 60)}:${pad(Math.round(total % 60))} (${VOICE}, ${RATE} wpm)`);
}

const cmd = process.argv[2];
if (cmd === "audio") audio();
else if (cmd === "slides") (await import("./slides.mjs")).renderSlides({ here, out });
else { console.error("usage: node docs/video/build.mjs audio|slides"); process.exit(2); }

// Fills the slide template with real captures and renders one PNG per slide with headless Chrome.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Colour the words that carry meaning in the terminal panels. */
function highlight(line) {
  return esc(line)
    .replace(/\bFAIL\b/g, '<span class="bad">FAIL</span>')
    .replace(/\bwarn\b/g, '<span class="warnc">warn</span>')
    .replace(/\b(blocked)\b/g, '<span class="bad">$1</span>')
    .replace(/\b(passed|pass|pending_review)\b/g, '<span class="good">$1</span>')
    .replace(/\[info\]/g, '<span class="info">[info]</span>')
    .replace(/^(Lead at .*)$/, '<span class="good">$1</span>');
}

function select(text, spec, name) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (!spec) return lines;
  if (spec.startsWith("grep=")) {
    const re = new RegExp(spec.slice(5));
    const kept = lines.filter((l) => re.test(l));
    if (!kept.length) throw new Error(`${name}: no line matches ${re}`);
    return kept;
  }
  const picked = [];
  for (const part of spec.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    for (let i = a; i <= b; i++) {
      if (i > lines.length) throw new Error(`${name}: line ${i} does not exist`);
      picked.push(lines[i - 1]);
    }
  }
  return picked;
}

export function renderSlides({ here, out }) {
  const caps = join(here, "captures");
  const read = (f) => {
    const p = join(caps, f);
    if (!existsSync(p)) throw new Error(`missing capture ${f}. Run docs/video/capture.sh`);
    return readFileSync(p, "utf8");
  };

  let html = readFileSync(join(here, "slides.template.html"), "utf8");

  html = html.replace(/\{\{capture:([^:}]+)(?::([^}]+))?\}\}/g, (_m, file, spec) =>
    select(read(file), spec, file).map(highlight).join("\n"));

  // The route explanation from `explain_lead`, shortened to the part that answers the question.
  html = html.replace("{{explain-route}}", () => {
    const route = read("explain.txt").split("\n").find((l) => l.startsWith("Route:")) || "";
    const matched = /Matched '([^']+)': ([^.]*(?:>=|<)[^.]*)\./.exec(route);
    const skipped = /enterprise \(([^)]*)\)/.exec(route);
    if (!matched || !skipped) throw new Error("explain.txt: could not find the route reason");
    return esc(`Route: matched '${matched[1]}' (${matched[2]})`) + "\n" + highlight(`       enterprise skipped: ${skipped[1]}`);
  });

  // The attacker's message, taken from the seed script that created the lead.
  html = html.replace("{{lead-message}}", () => {
    const seed = readFileSync(join(here, "..", "..", "scripts", "seed-demo-leads.sh"), "utf8");
    const m = /post injection[^\n]*"message":"([^"]+)"/.exec(seed);
    if (!m) throw new Error("could not find the injection message in scripts/seed-demo-leads.sh");
    return esc(m[1]);
  });

  // The cost table, parsed from the real tool output.
  html = html.replace("{{cost-table}}", () => {
    const re = /^(Build|Buy|Hybrid)\b(.*?)\s+([\d.]+)\s+(\$[\d,]+)\s+(\$[\d.,]+)\s+(\$[\d,]+)\s+(\S.*)$/;
    const rows = read("cost.txt").split("\n").map((l) => re.exec(l.trim())).filter(Boolean)
      .map((m) => [m[1] + m[2], m[3], m[4], m[5], m[6], m[7]]);
    if (rows.length !== 3) throw new Error("cost.txt: could not parse the three scenario rows");
    const nice = (d) => d.replace(/^humanReview/, "human review").replace(/^fixed\.platformFee/, "platform fee").replace(/^fixed\.engineeringUpkeep/, "engineering upkeep");
    const body = rows
      .map((r) => `<tr><td>${esc(r[0].replace(/\s*\(.*\)/, ""))}</td><td class="big">${esc(r[4])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(nice(r[5]))}</td></tr>`)
      .join("");
    return `<table class="cost"><tr><th>Option</th><th>Per meeting</th><th>Meetings / month</th><th>Monthly cost</th><th>Largest driver</th></tr>${body}</table>`;
  });

  if (/\{\{[^}]+\}\}/.test(html)) throw new Error(`unfilled placeholder: ${/\{\{[^}]+\}\}/.exec(html)[0]}`);

  const page = join(out, "slides.html");
  writeFileSync(page, html);
  const problems = [];
  const count = (html.match(/class="slide[^"]*" data-n=/g) || []).length;
  for (let n = 1; n <= count; n++) {
    const png = join(out, `slide-${String(n).padStart(2, "0")}.png`);
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      "--window-size=1920,1080", `--screenshot=${png}`, "--virtual-time-budget=1500",
      `${pathToFileURL(page).href}?n=${n}`,
    ], { stdio: "ignore" });
    const dom = execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--window-size=1920,1080", "--virtual-time-budget=1500", "--dump-dom",
      `${pathToFileURL(page).href}?n=${n}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const overflow = /data-overflow="([^"]*)"/.exec(dom)?.[1] ?? "";
    if (overflow) problems.push(`slide ${n}: content outside the safe area: ${overflow}`);
    console.log(`rendered ${png}${overflow ? "  <-- OVERFLOW" : ""}`);
  }
  if (problems.length) {
    console.error("\n" + problems.join("\n"));
    process.exitCode = 1;
  }
}

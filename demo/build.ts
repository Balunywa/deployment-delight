/*
 * Builds the narrated demo video:
 *   1. narration per scene — your own recording from demo/voice/<scene>.{wav,m4a,mp3,aiff} if present,
 *      otherwise macOS text-to-speech (DEMO_VOICE, default Samantha; DEMO_RATE words per minute)
 *   2. records the app with Playwright (demo/playwright.config.ts), each scene lasting at least its narration
 *   3. lays the narration over the recording, adds chapter subtitles, and writes demo/out/cloud-delivery-demo.mp4
 *
 * Needs ffmpeg (FFMPEG=/path/to/ffmpeg, or on PATH) and a production build (`npx vite build`).
 *   bun demo/build.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SCENES } from "./story";

const root = path.resolve(import.meta.dir, "..");
const out = path.resolve(process.env["DEMO_OUT"] ?? path.join(root, "demo/out"));
const voiceDir = path.join(root, "demo/voice");
const ffmpeg = process.env["FFMPEG"] ?? "ffmpeg";
const voice = process.env["DEMO_VOICE"] ?? "Samantha";
const rate = process.env["DEMO_RATE"] ?? "172";

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0)
    throw new Error(
      `${cmd} ${args.slice(0, 3).join(" ")}… failed:\n${r.stderr?.toString().slice(-2000)}`,
    );
  return r;
};

function durationOf(file: string) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "pipe", "pipe"] });
  const m = r.stderr.toString().match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`Couldn't read the duration of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

try {
  execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
} catch {
  throw new Error(
    "ffmpeg not found. Install it (brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.",
  );
}
if (!existsSync(path.join(root, ".output/server/index.mjs")))
  throw new Error("No production build. Run `npx vite build` first.");

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "audio"), { recursive: true });

// 1. Narration
const audio: Record<string, string> = {};
const durations: Record<string, number> = {};
for (const s of SCENES) {
  const own = ["wav", "m4a", "mp3", "aiff"]
    .map((ext) => path.join(voiceDir, `${s.id}.${ext}`))
    .find((f) => existsSync(f));
  let file = own;
  if (!file) {
    file = path.join(out, "audio", `${s.id}.aiff`);
    run("say", ["-v", voice, "-r", rate, "-o", file, s.narration]);
  }
  audio[s.id] = file;
  durations[s.id] = durationOf(file);
  console.log(
    `narration ${s.id}: ${durations[s.id]!.toFixed(1)}s${own ? " (your recording)" : ""}`,
  );
}
writeFileSync(path.join(out, "durations.json"), JSON.stringify(durations, null, 2));

// 2. Recording
console.log("recording the app…");
const rec = spawnSync("npx", ["playwright", "test", "-c", "demo/playwright.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DEMO_OUT: out },
});
if (rec.status !== 0) throw new Error("Recording failed; see the Playwright output above.");
const timings = JSON.parse(readFileSync(path.join(out, "timings.json"), "utf8")) as {
  id: string;
  startMs: number;
  endMs: number;
}[];
const findVideo = (dir: string): string | undefined => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const v = findVideo(p);
      if (v) return v;
    } else if (e.name.endsWith(".webm")) return p;
  }
  return undefined;
};
const video = findVideo(path.join(out, "playwright"));
if (!video) throw new Error("Playwright didn't produce a video.");

// 3. Subtitles: each scene's narration, sentence by sentence, spread over its spoken duration.
const stamp = (ms: number) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
};
const cues: string[] = [];
const chapters: string[] = [];
let lastChapter = "";
for (const t of timings) {
  const scene = SCENES.find((s) => s.id === t.id)!;
  if (scene.chapter !== lastChapter) {
    const sec = Math.round(t.startMs / 1000);
    chapters.push(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}  ${scene.chapter}`);
    lastChapter = scene.chapter;
  }
  const sentences = scene.narration.match(/[^.!?]+[.!?]+/g) ?? [scene.narration];
  const total = sentences.reduce((n, x) => n + x.length, 0);
  let at = t.startMs;
  for (const sentence of sentences) {
    const len = (durations[t.id]! * 1000 * sentence.length) / total;
    cues.push(`${cues.length + 1}\n${stamp(at)} --> ${stamp(at + len)}\n${sentence.trim()}\n`);
    at += len;
  }
}
const srt = path.join(out, "cloud-delivery-demo.srt");
writeFileSync(srt, cues.join("\n"));
writeFileSync(path.join(out, "chapters.txt"), `${chapters.join("\n")}\n`);

// 4. Assemble: recording + narration at each scene's start + soft subtitles.
const inputs = ["-i", video, ...SCENES.flatMap((s) => ["-i", audio[s.id]!]), "-i", srt];
const mix = SCENES.map((s, i) => {
  const ms = timings.find((t) => t.id === s.id)!.startMs;
  return `[${i + 1}:a]aresample=48000,adelay=${ms}|${ms}[a${i}]`;
});
const filter = `${mix.join(";")};${SCENES.map((_, i) => `[a${i}]`).join("")}amix=inputs=${SCENES.length}:normalize=0:dropout_transition=0,volume=1.3,alimiter=limit=0.89:level=false[aout]`;
const final = path.join(out, "cloud-delivery-demo.mp4");
console.log("assembling the video…");
run(ffmpeg, [
  "-y",
  "-hide_banner",
  ...inputs,
  "-filter_complex",
  filter,
  "-map",
  "0:v",
  "-map",
  "[aout]",
  "-map",
  `${SCENES.length + 1}:s`,
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-c:s",
  "mov_text",
  "-metadata:s:s:0",
  "language=eng",
  "-movflags",
  "+faststart",
  final,
]);
console.log(
  `\n${final}\n${(durationOf(final) / 60).toFixed(1)} minutes · chapters:\n${chapters.join("\n")}`,
);

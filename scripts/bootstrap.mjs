#!/usr/bin/env node
/**
 * Cross-platform bootstrap for the local TTS environment (spec V2.2 §5, §6).
 *
 *   node scripts/bootstrap.mjs            create .venv (CPU reference path)
 *   node scripts/bootstrap.mjs --xpu      create .venv-xpu with the Intel XPU torch build
 *   node scripts/bootstrap.mjs --check    report the resolved runtime and exit non-zero on problems
 *
 * Requirements this script enforces rather than assumes:
 *   - `uv` on PATH (https://docs.astral.sh/uv/) — it provisions a supported Python itself.
 *   - Python 3.12 for the venv. System Python 3.14 is NOT compatible with Chatterbox's
 *     dependency tree (spacy-pkuseg has no cp314 wheel and needs MSVC to build).
 *
 * No POSIX-only paths: interpreter locations are derived per platform.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const root = process.cwd();

const PYTHON_VERSION = "3.12";
const XPU_INDEX = "https://download.pytorch.org/whl/xpu";

function venvPython(dir) {
  return resolve(root, isWin ? `${dir}/Scripts/python.exe` : `${dir}/bin/python`);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: false, ...opts });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error(`"${cmd}" was not found on PATH.`);
    }
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`"${cmd}" exited with code ${res.status}`);
}

function haveUv() {
  const res = spawnSync("uv", ["--version"], { stdio: "pipe", shell: false });
  return !res.error && res.status === 0;
}

function check() {
  // tsx is a devDependency; run the resolver through it so this script stays JS-only.
  const tsx = resolve(root, isWin ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx");
  if (!existsSync(resolve(root, "node_modules"))) {
    console.error("node_modules is missing. Run: npm install");
    process.exit(1);
  }
  const res = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "src/system/runtime.ts"], {
    stdio: "inherit",
    shell: false
  });
  process.exit(res.status ?? 1);
}

function setup(xpu) {
  const venvDir = xpu ? ".venv-xpu" : ".venv";
  const py = venvPython(venvDir);

  if (!haveUv()) {
    console.error(
      "uv is required to provision a supported Python.\n" +
        (isWin
          ? "  Install: winget install --id=astral-sh.uv -e   (or: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\")"
          : "  Install: curl -LsSf https://astral.sh/uv/install.sh | sh")
    );
    process.exit(1);
  }

  console.log(`\n[bootstrap] Provisioning Python ${PYTHON_VERSION} (${xpu ? "Intel XPU" : "CPU reference"} TTS environment) in ${venvDir}`);
  run("uv", ["python", "install", PYTHON_VERSION]);
  if (!existsSync(py)) {
    run("uv", ["venv", "--python", PYTHON_VERSION, venvDir, "--seed"]);
  } else {
    console.log(`[bootstrap] ${venvDir} already exists; installing into it.`);
  }

  run("uv", ["pip", "install", "--python", py, "chatterbox-tts", "soundfile"]);

  if (xpu) {
    // Swap torch/torchaudio for the XPU build after chatterbox pulls its pinned CPU build,
    // so the rest of the dependency tree is satisfied first.
    run("uv", [
      "pip", "install", "--python", py,
      "--index-url", XPU_INDEX,
      "--reinstall-package", "torch", "--reinstall-package", "torchaudio",
      "torch", "torchaudio"
    ]);
  }

  console.log(`\n[bootstrap] Verifying imports in ${venvDir}...`);
  const verify = xpu
    ? "import torch, chatterbox, soundfile; print('torch', torch.__version__, '| xpu available:', torch.xpu.is_available())"
    : "import torch, chatterbox, soundfile; print('torch', torch.__version__, '| device: cpu')";
  run(py, ["-c", verify], { env: { ...process.env, TQDM_DISABLE: "1" } });

  console.log(`\n[bootstrap] Done. ${xpu ? "Set TTS_DEVICE=xpu (or leave unset: an existing .venv-xpu is an opt-in)." : "TTS_DEVICE=cpu is the reference path."}`);
  console.log("[bootstrap] Run `npm run runtime` to see the resolved environment.");
}

try {
  if (args.has("--check")) check();
  else setup(args.has("--xpu"));
} catch (err) {
  console.error(`\n[bootstrap] ${err.message}`);
  process.exit(1);
}

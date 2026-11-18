#!/usr/bin/env node
// Cargo never deletes old build artifacts. Each dependency bump leaves the
// previous compiled versions in src-tauri/target, so the folder grows without
// limit (it reached 6 GB). This script runs `cargo clean` when the folder is
// larger than a limit. The next build is then a full build.
//
// Limit: RUST_TARGET_MAX_GB (default 4). Set it to 0 to never prune.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tauriDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const targetDir = join(tauriDir, "target");
const maxGb = Number(process.env.RUST_TARGET_MAX_GB ?? 4);

function dirSize(dir) {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) total += dirSize(path);
		else if (entry.isFile()) total += lstatSync(path).size;
	}
	return total;
}

if (maxGb > 0 && existsSync(targetDir)) {
	const gb = dirSize(targetDir) / 1024 ** 3;
	if (gb > maxGb) {
		console.log(`src-tauri/target is ${gb.toFixed(1)} GB (limit ${maxGb} GB), running cargo clean`);
		execFileSync("cargo", ["clean"], { cwd: tauriDir, stdio: "inherit" });
	}
}

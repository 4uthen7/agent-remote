"use strict";

/**
 * Desktop update discovery against GitHub Releases.
 *
 * The macOS build is unsigned, so Squirrel/electron-updater cannot install
 * updates. Instead we compare the published desktop asset version with the
 * running app and point the user at the release page. All URLs opened from
 * this module are allowlisted to this repository's releases.
 */

const REPO = "4uthen7/agent-remote";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;

function parseVersion(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { major, minor, patch, text: `${major}.${minor}.${patch}` };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function isReleaseUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      (parsed.pathname === `/${REPO}/releases` ||
        parsed.pathname.startsWith(`/${REPO}/releases/`))
    );
  } catch {
    return false;
  }
}

function isDownloadUrl(url) {
  try {
    return isReleaseUrl(url) && new URL(url).pathname.includes(`/${REPO}/releases/download/`);
  } catch {
    return false;
  }
}

function assetCandidates(release, platform, arch) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const patterns = {
    darwin: /^Agent[ .]Remote-(\d+\.\d+\.\d+)(?:-(arm64|x64|universal))?(?:-mac)?\.(dmg|zip)$/i,
    win32: /^AgentRemote-(?:Setup-)?(\d+\.\d+\.\d+)(?:-(x64|arm64))?\.exe$/i,
    linux: /^Agent[ .]Remote-(\d+\.\d+\.\d+)(?:-(arm64|x64))?\.AppImage$/i,
  };
  const pattern = patterns[platform];
  if (!pattern) return [];
  const archTag = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";
  const candidates = [];
  for (const asset of assets) {
    const name = typeof asset?.name === "string" ? asset.name : "";
    const url = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
    const match = name.match(pattern);
    if (!match || !isDownloadUrl(url)) continue;
    const extension = (match[3] || "").toLowerCase();
    const assetArch = (match[2] || "").toLowerCase();
    let score = extension === "dmg" ? 10 : 0;
    if (/Setup/i.test(name)) score += 2;
    if (assetArch === archTag) score += 3;
    else if (!assetArch) score += 2;
    else if (assetArch === "universal") score += 1;
    candidates.push({ version: match[1], name, url, score });
  }
  return candidates.sort((a, b) => b.score - a.score || compareVersions(b.version, a.version));
}

function desktopAssetFor(release, platform, arch) {
  const [best] = assetCandidates(release, platform, arch);
  if (!best) return null;
  return { version: best.version, name: best.name, url: best.url };
}

function versionFromBody(body) {
  const match = String(body ?? "").match(/Desktop\s+\*{0,2}(\d+\.\d+\.\d+)\*{0,2}/i);
  return match ? match[1] : null;
}

async function checkForUpdate(options = {}) {
  const {
    currentVersion,
    platform = process.platform,
    arch = process.arch,
    fetchImpl = globalThis.fetch,
    timeoutMs = 7000,
  } = options;
  const current = parseVersion(currentVersion)?.text ?? String(currentVersion ?? "");
  const base = {
    current,
    latest: null,
    tag: null,
    releaseUrl: RELEASES_URL,
    assetUrl: null,
    checkedAt: Date.now(),
    error: null,
  };
  if (typeof fetchImpl !== "function") {
    return { ...base, status: "error", error: "fetch is unavailable" };
  }
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const response = await fetchImpl(API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Agent-Remote-Desktop/${current}`,
      },
      signal,
    });
    if (!response.ok) {
      return { ...base, status: "error", error: `GitHub API HTTP ${response.status}` };
    }
    const release = await response.json();
    const releaseUrl = isReleaseUrl(release?.html_url)
      ? release.html_url
      : `${RELEASES_URL}/latest`;
    const asset = desktopAssetFor(release, platform, arch);
    const latest = asset?.version ?? versionFromBody(release?.body);
    if (!latest) {
      return {
        ...base,
        status: "unknown",
        tag: typeof release?.tag_name === "string" ? release.tag_name : null,
        releaseUrl,
      };
    }
    return {
      ...base,
      status: compareVersions(latest, current) > 0 ? "available" : "current",
      latest,
      tag: typeof release?.tag_name === "string" ? release.tag_name : null,
      releaseUrl,
      assetUrl: asset?.url ?? null,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  REPO,
  RELEASES_URL,
  API_URL,
  parseVersion,
  compareVersions,
  isReleaseUrl,
  isDownloadUrl,
  desktopAssetFor,
  checkForUpdate,
};

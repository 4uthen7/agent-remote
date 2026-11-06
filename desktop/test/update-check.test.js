"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compareVersions,
  desktopAssetFor,
  checkForUpdate,
  isReleaseUrl,
  isDownloadUrl,
} = require("../update-check.js");

const ASSET_BASE = "https://github.com/4uthen7/agent-remote/releases/download/v1.1.4";

const RELEASE = {
  tag_name: "v1.1.4",
  html_url: "https://github.com/4uthen7/agent-remote/releases/tag/v1.1.4",
  body: "## v1.1.4\n\n- Desktop **1.0.10**, iOS **0.4.7**.",
  assets: [
    { name: "Agent.Remote-1.0.10-arm64-mac.zip", browser_download_url: `${ASSET_BASE}/Agent.Remote-1.0.10-arm64-mac.zip` },
    { name: "Agent.Remote-1.0.10-arm64.dmg", browser_download_url: `${ASSET_BASE}/Agent.Remote-1.0.10-arm64.dmg` },
    { name: "AgentRemote-0.4.7.ipa", browser_download_url: `${ASSET_BASE}/AgentRemote-0.4.7.ipa` },
    { name: "AgentRemote-1.0.10-x64.exe", browser_download_url: `${ASSET_BASE}/AgentRemote-1.0.10-x64.exe` },
    { name: "AgentRemote-Setup-1.0.10.exe", browser_download_url: `${ASSET_BASE}/AgentRemote-Setup-1.0.10.exe` },
    { name: "AgentRemote-android-debug.apk", browser_download_url: `${ASSET_BASE}/AgentRemote-android-debug.apk` },
  ],
};

function fakeFetch(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
}

test("compareVersions orders numeric components", () => {
  assert.equal(compareVersions("1.0.10", "1.0.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.0.10", "1.0.10"), 0);
  assert.equal(compareVersions("v1.0.2", "1.0.10"), -1);
  assert.equal(compareVersions("nope", "1.0.0"), 0);
});

test("desktopAssetFor picks the dmg for macOS arm64", () => {
  const asset = desktopAssetFor(RELEASE, "darwin", "arm64");
  assert.equal(asset.version, "1.0.10");
  assert.match(asset.url, /Agent\.Remote-1\.0\.10-arm64\.dmg$/);
});

test("desktopAssetFor prefers the Setup installer on Windows x64", () => {
  const asset = desktopAssetFor(RELEASE, "win32", "x64");
  assert.equal(asset.version, "1.0.10");
  assert.match(asset.url, /AgentRemote-Setup-1\.0\.10\.exe$/);
});

test("checkForUpdate reports a newer desktop build", async () => {
  const result = await checkForUpdate({
    currentVersion: "1.0.9",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: fakeFetch(RELEASE),
  });
  assert.equal(result.status, "available");
  assert.equal(result.current, "1.0.9");
  assert.equal(result.latest, "1.0.10");
  assert.equal(result.tag, "v1.1.4");
  assert.equal(result.releaseUrl, RELEASE.html_url);
  assert.match(result.assetUrl, /\.dmg$/);
});

test("checkForUpdate reports current when versions match", async () => {
  const result = await checkForUpdate({
    currentVersion: "1.0.10",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: fakeFetch(RELEASE),
  });
  assert.equal(result.status, "current");
  assert.equal(result.latest, "1.0.10");
});

test("checkForUpdate falls back to the release body for platforms without assets", async () => {
  const result = await checkForUpdate({
    currentVersion: "1.0.9",
    platform: "linux",
    arch: "x64",
    fetchImpl: fakeFetch(RELEASE),
  });
  assert.equal(result.status, "available");
  assert.equal(result.latest, "1.0.10");
  assert.equal(result.assetUrl, null);
});

test("checkForUpdate surfaces HTTP errors without throwing", async () => {
  const result = await checkForUpdate({
    currentVersion: "1.0.10",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: fakeFetch({}, 403),
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /403/);
});

test("checkForUpdate handles a thrown network error", async () => {
  const result = await checkForUpdate({
    currentVersion: "1.0.10",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(result.status, "error");
  assert.equal(result.error, "offline");
});

test("release and download URLs stay on this repository", () => {
  assert.equal(isReleaseUrl(RELEASE.html_url), true);
  assert.equal(isReleaseUrl("https://github.com/4uthen7/agent-remote/releases/latest"), true);
  assert.equal(isReleaseUrl("https://github.com/evil/repo/releases/tag/v1"), false);
  assert.equal(isReleaseUrl("http://github.com/4uthen7/agent-remote/releases"), false);
  assert.equal(isReleaseUrl("javascript:alert(1)"), false);
  assert.equal(isDownloadUrl(`${ASSET_BASE}/Agent.Remote-1.0.10-arm64.dmg`), true);
  assert.equal(isDownloadUrl("https://github.com/4uthen7/agent-remote/releases/tag/v1.1.4"), false);
});

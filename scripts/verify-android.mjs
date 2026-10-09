import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";

const checks = [];

async function filesWithin(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesWithin(path) : entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function check(name, passed, detail) {
  checks.push({ name, passed, detail });
}

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const variablesPath = resolve("android", "variables.gradle");
const manifestPath = resolve(
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const stringsPath = resolve(
  "android",
  "app",
  "src",
  "main",
  "res",
  "values",
  "strings.xml",
);
const mainActivityPath = resolve(
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "izcad",
  "viewer",
  "MainActivity.java",
);
const incomingDrawingPluginPath = resolve(
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "izcad",
  "viewer",
  "IncomingDrawingPlugin.java",
);
const webIndexPath = resolve(
  "android",
  "app",
  "src",
  "main",
  "assets",
  "public",
  "index.html",
);
const libreDwgJsPath = resolve(
  "public",
  "wasm",
  "libredwg-web.js",
);
const libreDwgWasmPath = resolve(
  "public",
  "wasm",
  "libredwg-web.wasm",
);
const drawingFontPath = resolve(
  "public",
  "fonts",
  "IzCadSans-Regular.ttf",
);
const androidWebRoot = resolve(
  "android",
  "app",
  "src",
  "main",
  "assets",
  "public",
);
const requiredPackagedNotices = [
  "LICENSE",
  "LICENSE-APACHE-2.0.txt",
  "LICENSE-MPL-2.0.txt",
  "NOTICE.md",
  "THIRD_PARTY_LICENSES.md",
];

const [variables, manifest, strings, mainActivity, incomingDrawingPlugin, appGradle, capacitorConfig, packageJson, filePaths] =
  await Promise.all([
    readFile(variablesPath, "utf8"),
    readFile(manifestPath, "utf8"),
    readFile(stringsPath, "utf8"),
    readFile(mainActivityPath, "utf8"),
    readFile(incomingDrawingPluginPath, "utf8"),
    readFile(resolve("android", "app", "build.gradle"), "utf8"),
    readFile(resolve("android", "app", "src", "main", "assets", "capacitor.config.json"), "utf8").then(JSON.parse),
    readFile(resolve("package.json"), "utf8").then(JSON.parse),
    readFile(resolve("android", "app", "src", "main", "res", "xml", "file_paths.xml"), "utf8"),
  ]);

check(
  "Minimum Android version",
  /minSdkVersion\s*=\s*26\b/.test(variables),
  "API 26 (Android 8) is required.",
);
check(
  "Play target and compile SDK",
  /compileSdkVersion\s*=\s*36\b/.test(variables) && /targetSdkVersion\s*=\s*36\b/.test(variables),
  "Google Play app updates require target API 36 from August 31, 2026.",
);
check(
  "Release version 2.0",
  /versionName\s+"2\.0"/.test(appGradle) && packageJson.version === "2.0.0" &&
    (/versionCode\s+4\b/.test(appGradle) || /IZCAD_VERSION_CODE/.test(appGradle) && /orElse\('4'\)/.test(appGradle)),
  "Package version must be 2.0.0; Android versionName 2.0 and default versionCode 4 (override above the highest Play code).",
);
check(
  "Stable application identity",
  /applicationId\s+"com\.izcad\.viewer"/.test(appGradle) && capacitorConfig.appId === "com.izcad.viewer",
  "Keep the existing Play package identity com.izcad.viewer.",
);
check(
  "Application name",
  /<string name="app_name">izCAD<\/string>/.test(strings),
  'Android launcher name must be "izCAD".',
);
check(
  "No broad storage permissions",
  !/android\.permission\.(?:READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|READ_MEDIA_)/.test(manifest),
  "Use Android file picker URI grants without shared-storage permissions.",
);
check(
  "No Android internet permission",
  !/android\.permission\.INTERNET/.test(manifest),
  "The offline application must not request INTERNET permission.",
);
check(
  "Private library backup disabled",
  /android:allowBackup="false"/.test(manifest) && /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(manifest) &&
    await exists(resolve("android", "app", "src", "main", "res", "xml", "backup_rules.xml")) &&
    await exists(resolve("android", "app", "src", "main", "res", "xml", "data_extraction_rules.xml")),
  "CAD documents and WebView data must be excluded from cloud and device-transfer backups.",
);
check(
  "Restricted file sharing provider",
  !/<(?:root|external)-path\b/.test(filePaths) && /<cache-path\b[^>]*path="shared\/"/.test(filePaths),
  "FileProvider may expose only the explicit shared drawing cache directory.",
);
check(
  "Production WebView security",
  capacitorConfig.android?.webContentsDebuggingEnabled === false && capacitorConfig.android?.allowMixedContent === false &&
    !capacitorConfig.server?.url && /debuggable\s+false/.test(appGradle),
  "Release uses bundled local assets, disables WebView debugging and mixed content, and is not debuggable.",
);
check(
  "Cleartext traffic disabled",
  /android:usesCleartextTraffic="false"/.test(manifest),
  "Android cleartext traffic must remain disabled.",
);
check(
  "Android system back and lifecycle bridge",
  /getOnBackPressedDispatcher\(\)/.test(incomingDrawingPlugin) && /"backPressed"/.test(incomingDrawingPlugin) &&
    /void exitApp\(PluginCall call\)/.test(incomingDrawingPlugin) && /"appStateChange"/.test(incomingDrawingPlugin),
  "Back must close app panels and drawings before exiting; lifecycle status must reach the web application.",
);
check(
  "File-provider queries off the UI thread",
  /metadataExecutor\.execute/.test(incomingDrawingPlugin) && /CancellationSignal/.test(incomingDrawingPlugin),
  "External file provider metadata must not block Android's main thread.",
);
check(
  "Android Open with support",
  /android\.intent\.action\.VIEW/.test(manifest) &&
    /android\.intent\.category\.DEFAULT/.test(manifest) &&
    /android:mimeType="image\/vnd\.dwg"/.test(manifest) &&
    /android:mimeType="application\/dxf"/.test(manifest),
  "The main activity must advertise DXF and DWG ACTION_VIEW support.",
);

const distRoot = resolve("dist");
let distFiles = [];
try {
  distFiles = await filesWithin(distRoot);
} catch {
  // A missing build is reported as a check failure below.
}
const mismatches = [];
for (const path of distFiles) {
  const outputPath = resolve(androidWebRoot, relative(distRoot, path));
  if (!await exists(outputPath) || hash(await readFile(path)) !== hash(await readFile(outputPath))) {
    mismatches.push(relative(distRoot, path));
  }
}
check(
  "Synced assets match the current production build",
  distFiles.length > 0 && mismatches.length === 0,
  mismatches.length ? `Run npm run android:sync. Stale/missing packaged files: ${mismatches.slice(0, 8).join(", ")}` : "Run npm run android:sync to produce and copy the current build.",
);
const packagedFiles = await exists(androidWebRoot) ? await filesWithin(androidWebRoot) : [];
check(
  "No release source maps",
  ![...distFiles, ...packagedFiles].some((path) => path.endsWith(".map")),
  "Production assets must omit JavaScript source maps.",
);
check(
  "Incoming drawing bridge",
  /registerPlugin\(IncomingDrawingPlugin\.class\)/.test(mainActivity) &&
    /@CapacitorPlugin\(name\s*=\s*"IncomingDrawing"\)/.test(
      incomingDrawingPlugin,
    ) &&
    /handleOnNewIntent\(Intent intent\)/.test(incomingDrawingPlugin),
  "The native bridge must pass Android file intents to the web application.",
);
check(
  "Synced web application",
  await exists(webIndexPath),
  "Run npm run android:sync after changing web code.",
);
check(
  "Offline drawing font",
  await exists(drawingFontPath),
  "The local TTF font is required for DXF TEXT and MTEXT entities.",
);
check(
  "LibreDWG JavaScript runtime",
  await exists(libreDwgJsPath),
  "Run npm run build to copy the pinned DWG runtime.",
);
check(
  "LibreDWG WebAssembly runtime",
  await exists(libreDwgWasmPath),
  "Run npm run build to copy the pinned DWG runtime.",
);
check(
  "Android DWG runtime",
  await Promise.all([
    "libredwg-web.js",
    "libredwg-web.wasm",
  ]).then((results) =>
    Promise.all(
      results.map((fileName) =>
        exists(resolve(androidWebRoot, "wasm", fileName)),
      ),
    ),
  ).then((results) => results.every(Boolean)),
  "Run npm run android:sync to copy the offline converter.",
);
check(
  "Android drawing font",
  await exists(
    resolve(
      androidWebRoot,
      "fonts",
      "IzCadSans-Regular.ttf",
    ),
  ),
  "Run npm run android:sync to copy the offline drawing font.",
);
check(
  "Android open-source notices",
  await Promise.all(
    requiredPackagedNotices.map((fileName) =>
      exists(resolve(androidWebRoot, "licenses", fileName)),
    ),
  ).then((results) => results.every(Boolean)),
  "Run npm run android:sync to package the required license notices.",
);

for (const result of checks) {
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}`);
  if (!result.passed) {
    console.log(`      ${result.detail}`);
  }
}

if (checks.some((result) => !result.passed)) {
  process.exitCode = 1;
} else {
  console.log("Android source project checks passed.");
}

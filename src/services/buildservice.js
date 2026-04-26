const fs = require("fs");
const path = require("path");
const execa = require("execa");

function findPackageJson(folderPath) {
  const packageJsonPath = path.join(folderPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  return packageJsonPath;
}

function readPackageJson(packageJsonPath) {
  const rawData = fs.readFileSync(packageJsonPath, "utf-8");
  return JSON.parse(rawData);
}

function detectPackageManager(folderPath) {
  if (fs.existsSync(path.join(folderPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (fs.existsSync(path.join(folderPath, "yarn.lock"))) {
    return "yarn";
  }

  if (fs.existsSync(path.join(folderPath, "package-lock.json"))) {
    return "npm";
  }

  return "npm";
}

function detectEntryFile(packageData, folderPath) {
  const scripts = packageData.scripts || {};

  const possibleEntries = [];

  if (packageData.main) {
    possibleEntries.push(packageData.main);
  }

  if (packageData.module) {
    possibleEntries.push(packageData.module);
  }

  Object.values(scripts).forEach((script) => {
    if (typeof script !== "string") return;

    const patterns = [
      /node\s+([^\s]+)/,
      /nodemon\s+([^\s]+)/,
      /ts-node\s+([^\s]+)/,
      /tsx\s+([^\s]+)/
    ];

    patterns.forEach((pattern) => {
      const match = script.match(pattern);

      if (match && match[1]) {
        possibleEntries.push(match[1]);
      }
    });
  });

  const fallbackEntries = [
    "src/server.js",
    "src/app.js",
    "server.js",
    "app.js",
    "index.js",
    "src/index.js"
  ];

  possibleEntries.push(...fallbackEntries);

  const uniqueEntries = [...new Set(possibleEntries)];

  for (const entry of uniqueEntries) {
    const cleanEntry = entry.replace(/^\.\/|^\//, "");
    const fullPath = path.join(folderPath, cleanEntry);

    if (fs.existsSync(fullPath)) {
      return cleanEntry;
    }
  }

  return null;
}

function detectBuildCommand(packageData, packageManager, folderPath) {
  const scripts = packageData.scripts || {};

  if (scripts.build) {
    return {
      mode: "script",
      command: packageManager,
      args: packageManager === "npm" ? ["run", "build"] : ["build"],
      scriptName: "build",
      scriptCommand: scripts.build,
      description: "Running package build script"
    };
  }

  if (scripts.test) {
    return {
      mode: "script",
      command: packageManager,
      args: packageManager === "npm" ? ["test"] : ["test"],
      scriptName: "test",
      scriptCommand: scripts.test,
      description: "Running package test script because build script was not found"
    };
  }

  const entryFile = detectEntryFile(packageData, folderPath);

  if (entryFile) {
    return {
      mode: "syntax-check",
      command: "node",
      args: ["--check", entryFile],
      scriptName: "syntax-check",
      scriptCommand: `node --check ${entryFile}`,
      entryFile,
      description: "Running safe syntax check because build/test script was not found"
    };
  }

  return null;
}

async function buildLocalProject(folderPath) {
  const absoluteFolderPath = path.resolve(folderPath);

  if (!fs.existsSync(absoluteFolderPath)) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message: "Folder does not exist",
      folderPath: absoluteFolderPath
    };
  }

  const stats = fs.statSync(absoluteFolderPath);

  if (!stats.isDirectory()) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message: "Provided path is not a folder",
      folderPath: absoluteFolderPath
    };
  }

  const packageJsonPath = findPackageJson(absoluteFolderPath);

  if (!packageJsonPath) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message: "package.json not found. This folder does not look like a Node.js project.",
      folderPath: absoluteFolderPath
    };
  }

  let packageData;

  try {
    packageData = readPackageJson(packageJsonPath);
  } catch (error) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message: "Invalid package.json file",
      folderPath: absoluteFolderPath,
      error: error.message
    };
  }

  const packageManager = detectPackageManager(absoluteFolderPath);
  const buildCommand = detectBuildCommand(
    packageData,
    packageManager,
    absoluteFolderPath
  );

  if (!buildCommand) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message:
        "No build/test script found and no valid entry file found for syntax check",
      folderPath: absoluteFolderPath,
      availableScripts: packageData.scripts || {}
    };
  }

  try {
    const result = await execa(buildCommand.command, buildCommand.args, {
      cwd: absoluteFolderPath,
      shell: true,
      all: true,
      timeout: 120000,
      env: {
        ...process.env,
        NODE_ENV: "test"
      }
    });

    return {
      success: true,
      status: "BUILD_SUCCESS",
      message:
        buildCommand.mode === "syntax-check"
          ? "Project syntax check completed successfully"
          : "Project build/check completed successfully",
      folderPath: absoluteFolderPath,
      packageManager,
      mode: buildCommand.mode,
      executedScript: buildCommand.scriptName,
      executedCommand: `${buildCommand.command} ${buildCommand.args.join(" ")}`,
      scriptCommand: buildCommand.scriptCommand,
      entryFile: buildCommand.entryFile || null,
      description: buildCommand.description,
      output: result.all || result.stdout || "",
      exitCode: result.exitCode
    };
  } catch (error) {
    return {
      success: false,
      status: "BUILD_FAILED",
      message:
        buildCommand.mode === "syntax-check"
          ? "Project syntax check failed"
          : "Project build/check failed",
      folderPath: absoluteFolderPath,
      packageManager,
      mode: buildCommand.mode,
      executedScript: buildCommand.scriptName,
      executedCommand: `${buildCommand.command} ${buildCommand.args.join(" ")}`,
      scriptCommand: buildCommand.scriptCommand,
      entryFile: buildCommand.entryFile || null,
      description: buildCommand.description,
      output: error.all || error.stdout || "",
      errorOutput: error.stderr || "",
      errorMessage: error.message,
      exitCode: error.exitCode || 1,
      timedOut: error.timedOut || false
    };
  }
}

module.exports = {
  buildLocalProject
};
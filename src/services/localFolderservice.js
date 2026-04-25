const fs = require("fs");
const path = require("path");
const { parseSourceFile } = require("./parserService");

const ignoredFolders = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".vscode"
];

function readLocalFolder(folderPath) {
  const folderName = path.basename(folderPath);

  if (ignoredFolders.includes(folderName)) {
    return null;
  }

  const stats = fs.statSync(folderPath);

  if (stats.isDirectory()) {
    const children = fs
      .readdirSync(folderPath)
      .map((childName) => {
        const childPath = path.join(folderPath, childName);
        return readLocalFolder(childPath);
      })
      .filter(Boolean);

    return {
      name: folderName,
      path: folderPath,
      type: "folder",
      children
    };
  }

  if (stats.isFile()) {
  const extension = path.extname(folderPath);
  const fileName = path.basename(folderPath);

  let parseResult = null;

  const supportedExtensions = [".js", ".jsx", ".ts", ".tsx"];
  const supportedJsonFiles = ["package.json", "tsconfig.json", "jsconfig.json"];

  if (
    supportedExtensions.includes(extension) ||
    supportedJsonFiles.includes(fileName)
  ) {
    const code = fs.readFileSync(folderPath, "utf-8");

    parseResult = parseSourceFile({
      fileName,
      filePath: folderPath,
      code
    });

    if (parseResult && parseResult.ast) {
      delete parseResult.ast;
    }
  } else {
    parseResult = {
      parseSuccess: false,
      reason: "Unsupported file type"
    };
  }

  return {
    name: fileName,
    path: folderPath,
    type: "file",
    extension,
    parseResult
  };
}

  return null;
}

module.exports = { readLocalFolder };
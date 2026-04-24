const path = require("path");
const babelParser = require("@babel/parser");

function parseSourceFile({ fileName, filePath, code }) {
  const extension = path.extname(fileName);

  const supportedExtensions = [".js", ".jsx", ".ts", ".tsx"];

  if (!supportedExtensions.includes(extension)) {
    return {
      parseSuccess: false,
      reason: "Unsupported file type"
    };
  }

  try {
    const ast = babelParser.parse(code, {
      sourceType: "unambiguous",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "objectRestSpread",
        "asyncGenerators",
        "decorators-legacy"
      ]
    });

    const summary = extractCodeSummary(ast);

    return {
      parseSuccess: true,
      fileName,
      filePath,
      summary,
      ast
    };
  } catch (error) {
    return {
      parseSuccess: false,
      fileName,
      filePath,
      error: error.message
    };
  }
}

function extractCodeSummary(ast) {
  const summary = {
    imports: [],
    exports: [],
    functions: [],
    variables: [],
    classes: []
  };

  const body = ast.program.body;

  for (const node of body) {
    if (node.type === "ImportDeclaration") {
      summary.imports.push({
        source: node.source.value,
        importedItems: node.specifiers.map((specifier) => specifier.local.name)
      });
    }

    if (node.type === "ExportNamedDeclaration") {
      summary.exports.push({
        type: "named-export"
      });
    }

    if (node.type === "ExportDefaultDeclaration") {
      summary.exports.push({
        type: "default-export"
      });
    }

    if (node.type === "FunctionDeclaration") {
      summary.functions.push({
        name: node.id ? node.id.name : "anonymous",
        params: node.params.map((param) => param.name || "unknown")
      });
    }

    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations) {
        if (declaration.id && declaration.id.name) {
          summary.variables.push({
            name: declaration.id.name,
            kind: node.kind
          });
        }

        if (
          declaration.init &&
          (
            declaration.init.type === "ArrowFunctionExpression" ||
            declaration.init.type === "FunctionExpression"
          )
        ) {
          summary.functions.push({
            name: declaration.id.name,
            params: declaration.init.params.map((param) => param.name || "unknown")
          });
        }
      }
    }

    if (node.type === "ClassDeclaration") {
      summary.classes.push({
        name: node.id ? node.id.name : "anonymous"
      });
    }
  }

  return summary;
}

module.exports = { parseSourceFile };
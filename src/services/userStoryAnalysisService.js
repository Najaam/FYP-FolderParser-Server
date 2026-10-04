const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

let analyses = [];
let nextAnalysisId = 1;

function getAllAnalyses() {
  return analyses;
}

function addAnalysis({ userStory, functionCode }) {
  const functionName = extractFunctionName(functionCode);

  const analysis = {
    id: nextAnalysisId,
    userStory,
    functionName,
    functionCode,
    status: "ANALYZED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  analyses.push(analysis);
  nextAnalysisId += 1;

  return analysis;
}

function updateAnalysis(id, { userStory, functionCode }) {
  const numericId = Number(id);
  const analysis = analyses.find((item) => item.id === numericId);

  if (!analysis) {
    return null;
  }

  if (userStory !== undefined) {
    analysis.userStory = userStory;
  }

  if (functionCode !== undefined) {
    analysis.functionCode = functionCode;
    analysis.functionName = extractFunctionName(functionCode);
  }

  analysis.updatedAt = new Date().toISOString();

  return analysis;
}

function extractFunctionName(functionCode) {
  if (!functionCode || typeof functionCode !== "string") {
    return "anonymous";
  }

  try {
    const ast = babelParser.parse(functionCode, {
      sourceType: "unambiguous",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "objectRestSpread",
        "asyncGenerators",
        "decorators-legacy",
        "dynamicImport"
      ]
    });

    let detectedName = null;

    traverse(ast, {
      FunctionDeclaration(pathNode) {
        if (!detectedName) {
          detectedName = pathNode.node.id?.name || "anonymous";
        }
      },

      VariableDeclarator(pathNode) {
        if (detectedName) return;

        const init = pathNode.node.init;

        if (
          init &&
          (init.type === "FunctionExpression" ||
            init.type === "ArrowFunctionExpression")
        ) {
          detectedName = getDeclarationName(pathNode.node.id) || "anonymous";
        }
      },

      ObjectMethod(pathNode) {
        if (!detectedName) {
          detectedName = getPropertyName(pathNode.node.key) || "anonymous";
        }
      },

      ClassMethod(pathNode) {
        if (!detectedName) {
          detectedName = getPropertyName(pathNode.node.key) || "anonymous";
        }
      },

      AssignmentExpression(pathNode) {
        if (detectedName) return;

        const right = pathNode.node.right;

        if (
          right &&
          (right.type === "FunctionExpression" ||
            right.type === "ArrowFunctionExpression")
        ) {
          detectedName = getMemberName(pathNode.node.left) || "anonymous";
        }
      }
    });

    return detectedName || "anonymous";
  } catch (error) {
    return "invalid-function-code";
  }
}

function getDeclarationName(node) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  return null;
}

function getPropertyName(node) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "StringLiteral") {
    return node.value;
  }

  return null;
}

function getMemberName(node) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "MemberExpression") {
    const propertyName = getPropertyName(node.property);
    return propertyName || getMemberName(node.object);
  }

  return null;
}

module.exports = {
  getAllAnalyses,
  addAnalysis,
  updateAnalysis,
  extractFunctionName
};

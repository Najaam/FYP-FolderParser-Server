const path = require("path");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

function parseSourceFile({ fileName, filePath, code }) {
  const extension = path.extname(fileName);

  const supportedExtensions = [".js", ".jsx", ".ts", ".tsx", ".json"];

  if (!supportedExtensions.includes(extension)) {
    return {
      parseSuccess: false,
      reason: "Unsupported file type"
    };
  }

  try {
    if (extension === ".json") {
      return parseJsonFile({ fileName, filePath, code });
    }

    const ast = babelParser.parse(code, {
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

    const summary = extractDetailedCodeSummary(ast, fileName, filePath);

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

function parseJsonFile({ fileName, filePath, code }) {
  try {
    const jsonData = JSON.parse(code);

    if (fileName === "package.json") {
      return {
        parseSuccess: true,
        fileName,
        filePath,
        fileType: "package-json",
        summary: parsePackageJson(jsonData, fileName, filePath)
      };
    }

    return {
      parseSuccess: true,
      fileName,
      filePath,
      fileType: "json",
      summary: {
        fileName,
        filePath,
        jsonType: "generic-json",
        keys: Object.keys(jsonData),
        totalKeys: Object.keys(jsonData).length,
        data: jsonData
      }
    };
  } catch (error) {
    return {
      parseSuccess: false,
      fileName,
      filePath,
      fileType: "json",
      error: `Invalid JSON: ${error.message}`
    };
  }
}

function extractDetailedCodeSummary(ast, fileName, filePath) {
  const summary = {
    fileName,
    filePath,

    imports: {
      totalImportedModules: 0,
      totalImportedItems: 0,
      usedImportedItems: 0,
      unusedImportedItems: 0,
      modules: []
    },

    exports: {
      totalExports: 0,
      namedExports: [],
      defaultExports: [],
      commonJsExports: [],
      exportedFunctions: [],
      exportedVariables: [],
      exportedClasses: []
    },

    functions: {
      totalFunctions: 0,
      list: [],
      dependencies: [],
      callGraph: {}
    },

    variables: {
      totalVariables: 0,
      list: []
    },

    classes: {
      totalClasses: 0,
      list: []
    },

    apiRoutes: {
      totalRoutes: 0,
      routes: []
    }
  };

  const importedIdentifiers = new Map();
  const usedIdentifiers = new Set();

  const functionMap = new Map();
  const functionStack = [];

  collectImportsAndExports(ast, summary, importedIdentifiers);

  collectDeclarationsAndUsages(
    ast,
    summary,
    importedIdentifiers,
    usedIdentifiers,
    functionMap,
    functionStack
  );

  finalizeImportUsage(summary, importedIdentifiers);
  finalizeFunctionDependencies(summary, functionMap);

  return summary;
}

function collectImportsAndExports(ast, summary, importedIdentifiers) {
  traverse(ast, {
    ImportDeclaration(pathNode) {
      const source = pathNode.node.source.value;

      const moduleInfo = {
        source,
        importType: "esm",
        importedItems: [],
        totalImportedItems: pathNode.node.specifiers.length,
        usedItems: [],
        unusedItems: []
      };

      pathNode.node.specifiers.forEach((specifier) => {
        let importKind = "unknown";
        let importedName = null;
        let localName = null;

        if (specifier.type === "ImportDefaultSpecifier") {
          importKind = "default";
          importedName = "default";
          localName = specifier.local.name;
        }

        if (specifier.type === "ImportSpecifier") {
          importKind = "named";
          importedName = getPropertyName(specifier.imported);
          localName = specifier.local.name;
        }

        if (specifier.type === "ImportNamespaceSpecifier") {
          importKind = "namespace";
          importedName = "*";
          localName = specifier.local.name;
        }

        const item = {
          importKind,
          importedName,
          localName,
          source,
          used: false,
          usageCount: 0
        };

        moduleInfo.importedItems.push(item);

        if (localName) {
          importedIdentifiers.set(localName, item);
        }
      });

      summary.imports.modules.push(moduleInfo);
      summary.imports.totalImportedModules += 1;
      summary.imports.totalImportedItems += moduleInfo.totalImportedItems;
    },

    VariableDeclarator(pathNode) {
      const node = pathNode.node;

      if (!isRequireCall(node.init)) {
        return;
      }

      const source = node.init.arguments[0].value;
      const importedItems = getRequireImportedItems(node.id, source);

      if (importedItems.length === 0) {
        return;
      }

      const moduleInfo = {
        source,
        importType: "commonjs",
        importedItems,
        totalImportedItems: importedItems.length,
        usedItems: [],
        unusedItems: []
      };

      importedItems.forEach((item) => {
        if (item.localName) {
          importedIdentifiers.set(item.localName, item);
        }
      });

      summary.imports.modules.push(moduleInfo);
      summary.imports.totalImportedModules += 1;
      summary.imports.totalImportedItems += moduleInfo.totalImportedItems;
    },

    ExportNamedDeclaration(pathNode) {
      const node = pathNode.node;

      summary.exports.totalExports += 1;

      if (node.declaration) {
        if (node.declaration.type === "FunctionDeclaration") {
          const name = node.declaration.id?.name || "anonymous";

          summary.exports.exportedFunctions.push(name);
          summary.exports.namedExports.push({
            type: "function",
            name
          });
        }

        if (node.declaration.type === "VariableDeclaration") {
          node.declaration.declarations.forEach((declaration) => {
            const names = getDeclarationNames(declaration.id);

            names.forEach((name) => {
              summary.exports.exportedVariables.push(name);
              summary.exports.namedExports.push({
                type: "variable",
                name
              });
            });
          });
        }

        if (node.declaration.type === "ClassDeclaration") {
          const name = node.declaration.id?.name || "anonymous";

          summary.exports.exportedClasses.push(name);
          summary.exports.namedExports.push({
            type: "class",
            name
          });
        }
      }

      if (node.specifiers && node.specifiers.length > 0) {
        node.specifiers.forEach((specifier) => {
          summary.exports.namedExports.push({
            type: "specifier",
            localName: specifier.local?.name || null,
            exportedName: specifier.exported?.name || null
          });
        });
      }
    },

    ExportDefaultDeclaration(pathNode) {
      const declaration = pathNode.node.declaration;

      summary.exports.totalExports += 1;

      const exportInfo = {
        type: declaration.type,
        name: null
      };

      if (declaration.id && declaration.id.name) {
        exportInfo.name = declaration.id.name;
      }

      if (declaration.type === "Identifier") {
        exportInfo.name = declaration.name;
      }

      summary.exports.defaultExports.push(exportInfo);
    },

    AssignmentExpression(pathNode) {
      const node = pathNode.node;

      if (!isCommonJsExport(node.left)) {
        return;
      }

      const exportName = getCommonJsExportName(node.left);
      const exportValue = getExportValueName(node.right);

      summary.exports.totalExports += 1;

      summary.exports.commonJsExports.push({
        type: "commonjs",
        exportName,
        value: exportValue,
        rightNodeType: node.right?.type || null
      });

      if (node.right?.type === "FunctionExpression" || node.right?.type === "ArrowFunctionExpression") {
        summary.exports.exportedFunctions.push(exportName);
      } else if (node.right?.type === "ClassExpression") {
        summary.exports.exportedClasses.push(exportName);
      } else {
        summary.exports.exportedVariables.push(exportName);
      }
    }
  });
}

function collectDeclarationsAndUsages(
  ast,
  summary,
  importedIdentifiers,
  usedIdentifiers,
  functionMap,
  functionStack
) {
  traverse(ast, {
    Identifier(pathNode) {
      const name = pathNode.node.name;

      if (!importedIdentifiers.has(name)) {
        return;
      }

      if (isImportIdentifierReference(pathNode)) {
        const importedItem = importedIdentifiers.get(name);

        importedItem.used = true;
        importedItem.usageCount += 1;

        usedIdentifiers.add(name);
      }
    },

    FunctionDeclaration: {
      enter(pathNode) {
        const functionName = pathNode.node.id?.name || "anonymous";

        registerFunction(summary, functionMap, {
          name: functionName,
          type: "FunctionDeclaration",
          params: getParams(pathNode.node.params),
          async: pathNode.node.async,
          generator: pathNode.node.generator,
          startLine: pathNode.node.loc?.start?.line || null,
          endLine: pathNode.node.loc?.end?.line || null
        });

        functionStack.push(functionName);
      },

      exit() {
        functionStack.pop();
      }
    },

    FunctionExpression: {
      enter(pathNode) {
        const functionName = getFunctionExpressionName(pathNode);

        registerFunction(summary, functionMap, {
          name: functionName,
          type: "FunctionExpression",
          params: getParams(pathNode.node.params),
          async: pathNode.node.async,
          generator: pathNode.node.generator,
          startLine: pathNode.node.loc?.start?.line || null,
          endLine: pathNode.node.loc?.end?.line || null
        });

        functionStack.push(functionName);
      },

      exit() {
        functionStack.pop();
      }
    },

    ArrowFunctionExpression: {
      enter(pathNode) {
        const functionName = getFunctionExpressionName(pathNode);

        registerFunction(summary, functionMap, {
          name: functionName,
          type: "ArrowFunctionExpression",
          params: getParams(pathNode.node.params),
          async: pathNode.node.async,
          generator: false,
          startLine: pathNode.node.loc?.start?.line || null,
          endLine: pathNode.node.loc?.end?.line || null
        });

        functionStack.push(functionName);
      },

      exit() {
        functionStack.pop();
      }
    },

    VariableDeclaration(pathNode) {
      pathNode.node.declarations.forEach((declaration) => {
        const names = getDeclarationNames(declaration.id);

        names.forEach((name) => {
          summary.variables.list.push({
            name,
            kind: pathNode.node.kind,
            startLine: declaration.loc?.start?.line || null,
            endLine: declaration.loc?.end?.line || null,
            isRequireImport: isRequireCall(declaration.init)
          });
        });
      });

      summary.variables.totalVariables = summary.variables.list.length;
    },

    ClassDeclaration(pathNode) {
      const className = pathNode.node.id?.name || "anonymous";

      const classInfo = {
        name: className,
        methods: [],
        startLine: pathNode.node.loc?.start?.line || null,
        endLine: pathNode.node.loc?.end?.line || null
      };

      pathNode.node.body.body.forEach((classMember) => {
        if (
          classMember.type === "ClassMethod" ||
          classMember.type === "ClassPrivateMethod" ||
          classMember.type === "ClassProperty" ||
          classMember.type === "PropertyDefinition"
        ) {
          classInfo.methods.push({
            name: getPropertyName(classMember.key),
            kind: classMember.kind || "property",
            params: getParams(classMember.params || [])
          });
        }
      });

      summary.classes.list.push(classInfo);
      summary.classes.totalClasses = summary.classes.list.length;
    },

    CallExpression(pathNode) {
      const currentFunction = functionStack[functionStack.length - 1] || "global";
      const calledFunction = getCalledFunctionName(pathNode.node.callee);

      if (!calledFunction) return;

      if (!functionMap.has(currentFunction)) {
        functionMap.set(currentFunction, {
          name: currentFunction,
          calls: new Set(),
          calledBy: new Set(),
          externalCalls: new Set(),
          importedCalls: new Set()
        });
      }

      const currentInfo = functionMap.get(currentFunction);

      currentInfo.calls.add(calledFunction);

      const rootCallName = calledFunction.split(".")[0];

      if (importedIdentifiers.has(calledFunction) || importedIdentifiers.has(rootCallName)) {
        currentInfo.importedCalls.add(calledFunction);
      }

      detectApiRoute(pathNode.node, summary);
    }
  });
}

function registerFunction(summary, functionMap, functionInfo) {
  const name = functionInfo.name || "anonymous";

  const existingFunction = summary.functions.list.find(
    (item) => item.name === name && item.startLine === functionInfo.startLine
  );

  if (!existingFunction) {
    summary.functions.list.push({
      ...functionInfo,
      calls: [],
      calledBy: [],
      internalCalls: [],
      externalCalls: [],
      importedCalls: []
    });

    summary.functions.totalFunctions = summary.functions.list.length;
  }

  if (!functionMap.has(name)) {
    functionMap.set(name, {
      name,
      calls: new Set(),
      calledBy: new Set(),
      externalCalls: new Set(),
      importedCalls: new Set()
    });
  }
}

function finalizeImportUsage(summary, importedIdentifiers) {
  summary.imports.modules.forEach((moduleInfo) => {
    moduleInfo.usedItems = [];
    moduleInfo.unusedItems = [];

    moduleInfo.importedItems.forEach((item) => {
      const trackedItem = importedIdentifiers.get(item.localName);

      if (trackedItem) {
        item.used = trackedItem.used;
        item.usageCount = trackedItem.usageCount;
      }

      if (item.used) {
        moduleInfo.usedItems.push(item.localName);
      } else {
        moduleInfo.unusedItems.push(item.localName);
      }
    });
  });

  const allImportedItems = Array.from(importedIdentifiers.values());

  summary.imports.usedImportedItems = allImportedItems.filter(
    (item) => item.used
  ).length;

  summary.imports.unusedImportedItems = allImportedItems.filter(
    (item) => !item.used
  ).length;
}

function finalizeFunctionDependencies(summary, functionMap) {
  const functionNames = new Set(summary.functions.list.map((item) => item.name));

  const calledByMap = new Map();

  summary.functions.list.forEach((func) => {
    calledByMap.set(func.name, new Set());
  });

  functionMap.forEach((functionInfo, functionName) => {
    functionInfo.calls.forEach((calledFunction) => {
      if (functionNames.has(calledFunction) && calledByMap.has(calledFunction)) {
        calledByMap.get(calledFunction).add(functionName);
      }
    });
  });

  summary.functions.list = summary.functions.list.map((func) => {
    const functionInfo = functionMap.get(func.name);

    if (!functionInfo) {
      return func;
    }

    const calls = Array.from(functionInfo.calls);
    const internalCalls = calls.filter((call) => functionNames.has(call));
    const importedCalls = Array.from(functionInfo.importedCalls);

    const externalCalls = calls.filter(
      (call) => !functionNames.has(call) && !importedCalls.includes(call)
    );

    return {
      ...func,
      calls,
      internalCalls,
      externalCalls,
      importedCalls,
      calledBy: Array.from(calledByMap.get(func.name) || [])
    };
  });

  summary.functions.dependencies = summary.functions.list.map((func) => ({
    functionName: func.name,
    dependsOnInternalFunctions: func.internalCalls || [],
    dependsOnExternalFunctions: func.externalCalls || [],
    dependsOnImportedFunctions: func.importedCalls || [],
    calledBy: func.calledBy || []
  }));

  summary.functions.callGraph = {};

  summary.functions.list.forEach((func) => {
    summary.functions.callGraph[func.name] = {
      calls: func.calls || [],
      calledBy: func.calledBy || [],
      internalCalls: func.internalCalls || [],
      externalCalls: func.externalCalls || [],
      importedCalls: func.importedCalls || []
    };
  });
}

function detectApiRoute(callNode, summary) {
  const callee = callNode.callee;

  if (!callee || callee.type !== "MemberExpression") {
    return;
  }

  const objectName = getCalledFunctionName(callee.object);
  const methodName = getPropertyName(callee.property);

  const httpMethods = ["get", "post", "put", "patch", "delete", "use"];

  if (!httpMethods.includes(methodName)) {
    return;
  }

  if (!callNode.arguments || callNode.arguments.length === 0) {
    return;
  }

  const firstArg = callNode.arguments[0];

  if (firstArg.type !== "StringLiteral") {
    return;
  }

  summary.apiRoutes.routes.push({
    routerObject: objectName,
    method: methodName.toUpperCase(),
    path: firstArg.value,
    handlers: callNode.arguments.slice(1).map((arg) => getCalledFunctionName(arg))
  });

  summary.apiRoutes.totalRoutes = summary.apiRoutes.routes.length;
}

function isRequireCall(node) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments &&
    node.arguments.length > 0 &&
    node.arguments[0].type === "StringLiteral"
  );
}

function getRequireImportedItems(idNode, source) {
  if (!idNode) return [];

  if (idNode.type === "Identifier") {
    return [
      {
        importKind: "require-default",
        importedName: "module",
        localName: idNode.name,
        source,
        used: false,
        usageCount: 0
      }
    ];
  }

  if (idNode.type === "ObjectPattern") {
    return idNode.properties
      .map((property) => {
        if (property.type === "ObjectProperty") {
          const importedName = getPropertyName(property.key);
          const localName = getDeclarationName(property.value);

          return {
            importKind: "require-named",
            importedName,
            localName,
            source,
            used: false,
            usageCount: 0
          };
        }

        if (property.type === "RestElement") {
          const localName = getDeclarationName(property.argument);

          return {
            importKind: "require-rest",
            importedName: "...rest",
            localName,
            source,
            used: false,
            usageCount: 0
          };
        }

        return null;
      })
      .filter((item) => item && item.localName);
  }

  if (idNode.type === "ArrayPattern") {
    return idNode.elements
      .map((element, index) => {
        const localName = getDeclarationName(element);

        if (!localName) return null;

        return {
          importKind: "require-array",
          importedName: String(index),
          localName,
          source,
          used: false,
          usageCount: 0
        };
      })
      .filter(Boolean);
  }

  return [];
}

function isCommonJsExport(leftNode) {
  const exportName = getCalledFunctionName(leftNode);

  if (!exportName) return false;

  return (
    exportName === "module.exports" ||
    exportName.startsWith("module.exports.") ||
    exportName.startsWith("exports.")
  );
}

function getCommonJsExportName(leftNode) {
  const exportName = getCalledFunctionName(leftNode);

  if (!exportName) return "unknown";

  if (exportName === "module.exports") {
    return "module.exports";
  }

  if (exportName.startsWith("module.exports.")) {
    return exportName.replace("module.exports.", "");
  }

  if (exportName.startsWith("exports.")) {
    return exportName.replace("exports.", "");
  }

  return exportName;
}

function getExportValueName(rightNode) {
  if (!rightNode) return null;

  if (rightNode.type === "Identifier") {
    return rightNode.name;
  }

  if (
    rightNode.type === "FunctionExpression" ||
    rightNode.type === "ArrowFunctionExpression"
  ) {
    return "function";
  }

  if (rightNode.type === "ClassExpression") {
    return rightNode.id?.name || "class";
  }

  if (rightNode.type === "ObjectExpression") {
    return "object";
  }

  if (rightNode.type === "ArrayExpression") {
    return "array";
  }

  if (rightNode.type === "CallExpression") {
    return getCalledFunctionName(rightNode.callee);
  }

  return rightNode.type;
}

function isImportIdentifierReference(pathNode) {
  if (!pathNode.isReferencedIdentifier()) {
    return false;
  }

  const parent = pathNode.parent;

  if (!parent) {
    return false;
  }

  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier"
  ) {
    return false;
  }

  if (parent.type === "VariableDeclarator" && parent.id === pathNode.node) {
    return false;
  }

  if (
    parent.type === "ObjectProperty" &&
    parent.value === pathNode.node &&
    parent.parent &&
    parent.parent.type === "ObjectPattern"
  ) {
    return false;
  }

  return true;
}

function getFunctionExpressionName(pathNode) {
  const parent = pathNode.parent;

  if (!parent) {
    return "anonymous";
  }

  if (parent.type === "VariableDeclarator") {
    return getDeclarationName(parent.id) || "anonymous";
  }

  if (parent.type === "AssignmentExpression") {
    return getCalledFunctionName(parent.left) || "anonymous";
  }

  if (parent.type === "ObjectProperty") {
    return getPropertyName(parent.key) || "anonymous";
  }

  if (parent.type === "ClassMethod") {
    return getPropertyName(parent.key) || "anonymous";
  }

  return "anonymous";
}

function getCalledFunctionName(callee) {
  if (!callee) return null;

  if (callee.type === "Identifier") {
    return callee.name;
  }

  if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
    const objectName = getCalledFunctionName(callee.object);
    const propertyName = getPropertyName(callee.property);

    if (objectName && propertyName) {
      return `${objectName}.${propertyName}`;
    }

    return propertyName || objectName;
  }

  if (callee.type === "ThisExpression") {
    return "this";
  }

  if (callee.type === "Super") {
    return "super";
  }

  if (callee.type === "CallExpression") {
    return getCalledFunctionName(callee.callee);
  }

  return null;
}

function getPropertyName(property) {
  if (!property) return null;

  if (property.type === "Identifier") {
    return property.name;
  }

  if (property.type === "StringLiteral") {
    return property.value;
  }

  if (property.type === "NumericLiteral") {
    return String(property.value);
  }

  if (property.type === "PrivateName") {
    return property.id?.name || null;
  }

  return null;
}

function getDeclarationName(declarationId) {
  if (!declarationId) return null;

  if (declarationId.type === "Identifier") {
    return declarationId.name;
  }

  if (declarationId.type === "ObjectPattern") {
    return declarationId.properties
      .map((property) => {
        if (property.type === "ObjectProperty") {
          return getPropertyName(property.key);
        }

        if (property.type === "RestElement") {
          return getDeclarationName(property.argument);
        }

        return null;
      })
      .filter(Boolean)
      .join(", ");
  }

  if (declarationId.type === "ArrayPattern") {
    return "array-destructuring";
  }

  if (declarationId.type === "MemberExpression") {
    return getCalledFunctionName(declarationId);
  }

  return null;
}

function getDeclarationNames(declarationId) {
  if (!declarationId) return [];

  if (declarationId.type === "Identifier") {
    return [declarationId.name];
  }

  if (declarationId.type === "ObjectPattern") {
    return declarationId.properties
      .map((property) => {
        if (property.type === "ObjectProperty") {
          return getDeclarationName(property.value) || getPropertyName(property.key);
        }

        if (property.type === "RestElement") {
          return getDeclarationName(property.argument);
        }

        return null;
      })
      .filter(Boolean);
  }

  if (declarationId.type === "ArrayPattern") {
    return declarationId.elements
      .map((element) => getDeclarationName(element))
      .filter(Boolean);
  }

  return [];
}

function getParams(params) {
  return params.map((param) => {
    if (param.type === "Identifier") {
      return param.name;
    }

    if (param.type === "AssignmentPattern") {
      return getDeclarationName(param.left) || "default-param";
    }

    if (param.type === "RestElement") {
      return `...${getDeclarationName(param.argument)}`;
    }

    if (param.type === "ObjectPattern") {
      return "object-param";
    }

    if (param.type === "ArrayPattern") {
      return "array-param";
    }

    return "unknown";
  });
}

function parsePackageJson(packageData, fileName, filePath) {
  const dependencies = packageData.dependencies || {};
  const devDependencies = packageData.devDependencies || {};
  const scripts = packageData.scripts || {};

  const allDependencies = {
    ...dependencies,
    ...devDependencies
  };

  const detectedFrameworks = detectFrameworks(allDependencies, scripts);
  const detectedTestTools = detectTestTools(allDependencies, scripts);

  const entryPoints = detectEntryPoints(packageData, scripts);

  return {
    fileName,
    filePath,
    projectInfo: {
      name: packageData.name || null,
      version: packageData.version || null,
      description: packageData.description || null,
      projectType: packageData.type || "commonjs",
      private: packageData.private || false,
      license: packageData.license || null
    },

    entryPoints,

    scripts: {
      totalScripts: Object.keys(scripts).length,
      availableScripts: scripts,
      startScript: scripts.start || null,
      devScript: scripts.dev || null,
      testScript: scripts.test || null,
      buildScript: scripts.build || null
    },

    dependencies: {
      totalDependencies: Object.keys(dependencies).length,
      totalDevDependencies: Object.keys(devDependencies).length,
      dependencies,
      devDependencies,
      all: allDependencies
    },

    detectedStack: {
      frameworks: detectedFrameworks,
      testTools: detectedTestTools,
      runtime: detectRuntime(allDependencies, scripts),
      packageManagerHint: detectPackageManager(filePath)
    },

    devSureHints: {
      probableEntryFile: entryPoints.primaryEntry,
      probableStartCommand: scripts.dev || scripts.start || null,
      probableTestCommand: scripts.test || null,
      moduleSystem: packageData.type === "module" ? "esm" : "commonjs",
      hasTestScript: Boolean(scripts.test),
      hasDevScript: Boolean(scripts.dev),
      hasStartScript: Boolean(scripts.start),
      shouldLookForServerFile: shouldLookForServerFile(packageData, scripts, allDependencies),
      shouldLookForRoutes: hasAnyDependency(allDependencies, [
        "express",
        "fastify",
        "koa",
        "hapi",
        "@hapi/hapi"
      ])
    }
  };
}

function detectEntryPoints(packageData, scripts) {
  const entryPoints = {
    main: packageData.main || null,
    module: packageData.module || null,
    browser: packageData.browser || null,
    exports: packageData.exports || null,
    bin: packageData.bin || null,
    primaryEntry: null,
    possibleEntries: []
  };

  if (packageData.main) {
    entryPoints.possibleEntries.push(packageData.main);
  }

  if (packageData.module) {
    entryPoints.possibleEntries.push(packageData.module);
  }

  if (typeof packageData.exports === "string") {
    entryPoints.possibleEntries.push(packageData.exports);
  }

  if (typeof packageData.exports === "object" && packageData.exports !== null) {
    Object.values(packageData.exports).forEach((value) => {
      if (typeof value === "string") {
        entryPoints.possibleEntries.push(value);
      }

      if (typeof value === "object" && value !== null) {
        Object.values(value).forEach((nestedValue) => {
          if (typeof nestedValue === "string") {
            entryPoints.possibleEntries.push(nestedValue);
          }
        });
      }
    });
  }

  const scriptEntries = extractEntryFilesFromScripts(scripts);
  entryPoints.possibleEntries.push(...scriptEntries);

  entryPoints.possibleEntries = [...new Set(entryPoints.possibleEntries)];

  entryPoints.primaryEntry =
    packageData.main ||
    packageData.module ||
    scriptEntries[0] ||
    "index.js";

  return entryPoints;
}

function extractEntryFilesFromScripts(scripts) {
  const entries = [];

  Object.values(scripts || {}).forEach((script) => {
    if (typeof script !== "string") return;

    const patterns = [
      /node\s+([^\s]+)/,
      /nodemon\s+([^\s]+)/,
      /ts-node\s+([^\s]+)/,
      /tsx\s+([^\s]+)/,
      /vite\s+--host\s+([^\s]+)/
    ];

    patterns.forEach((pattern) => {
      const match = script.match(pattern);

      if (match && match[1]) {
        const file = match[1];

        if (
          file.endsWith(".js") ||
          file.endsWith(".ts") ||
          file.endsWith(".mjs") ||
          file.endsWith(".cjs")
        ) {
          entries.push(file);
        }
      }
    });
  });

  return entries;
}

function detectFrameworks(dependencies, scripts) {
  const frameworks = [];

  const frameworkMap = {
    express: "Express.js",
    fastify: "Fastify",
    koa: "Koa.js",
    "@nestjs/core": "NestJS",
    next: "Next.js",
    react: "React",
    vue: "Vue",
    "@angular/core": "Angular",
    vite: "Vite",
    "react-scripts": "Create React App",
    "apollo-server": "Apollo Server",
    graphql: "GraphQL"
  };

  Object.keys(frameworkMap).forEach((dep) => {
    if (dependencies[dep]) {
      frameworks.push({
        name: frameworkMap[dep],
        package: dep,
        version: dependencies[dep]
      });
    }
  });

  Object.entries(scripts || {}).forEach(([scriptName, command]) => {
    if (typeof command !== "string") return;

    if (command.includes("next")) {
      addUniqueFramework(frameworks, "Next.js", "script", scriptName);
    }

    if (command.includes("vite")) {
      addUniqueFramework(frameworks, "Vite", "script", scriptName);
    }

    if (command.includes("nodemon") || command.includes("node")) {
      addUniqueFramework(frameworks, "Node.js Backend", "script", scriptName);
    }
  });

  return frameworks;
}

function addUniqueFramework(frameworks, name, source, value) {
  const exists = frameworks.some((framework) => framework.name === name);

  if (!exists) {
    frameworks.push({
      name,
      package: source,
      version: value
    });
  }
}

function detectTestTools(dependencies, scripts) {
  const tools = [];

  const testToolMap = {
    jest: "Jest",
    mocha: "Mocha",
    chai: "Chai",
    vitest: "Vitest",
    cypress: "Cypress",
    playwright: "Playwright",
    supertest: "Supertest",
    "@testing-library/react": "React Testing Library"
  };

  Object.keys(testToolMap).forEach((dep) => {
    if (dependencies[dep]) {
      tools.push({
        name: testToolMap[dep],
        package: dep,
        version: dependencies[dep]
      });
    }
  });

  Object.entries(scripts || {}).forEach(([scriptName, command]) => {
    if (typeof command !== "string") return;

    Object.keys(testToolMap).forEach((toolPackage) => {
      if (command.includes(toolPackage)) {
        const exists = tools.some((tool) => tool.package === toolPackage);

        if (!exists) {
          tools.push({
            name: testToolMap[toolPackage],
            package: toolPackage,
            version: `script:${scriptName}`
          });
        }
      }
    });
  });

  return tools;
}

function detectRuntime(dependencies, scripts) {
  if (dependencies.next || scriptIncludes(scripts, "next")) {
    return "nextjs";
  }

  if (dependencies.vite || scriptIncludes(scripts, "vite")) {
    return "vite";
  }

  if (
    dependencies.express ||
    dependencies.fastify ||
    dependencies.koa ||
    scriptIncludes(scripts, "node") ||
    scriptIncludes(scripts, "nodemon")
  ) {
    return "nodejs";
  }

  return "unknown";
}

function detectPackageManager(filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");

  if (normalizedPath.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (normalizedPath.includes("yarn.lock")) {
    return "yarn";
  }

  if (normalizedPath.includes("package-lock.json")) {
    return "npm";
  }

  return "npm-or-unknown";
}

function shouldLookForServerFile(packageData, scripts, dependencies) {
  if (packageData.main) return true;

  if (scriptIncludes(scripts, "node")) return true;
  if (scriptIncludes(scripts, "nodemon")) return true;

  return hasAnyDependency(dependencies, [
    "express",
    "fastify",
    "koa",
    "@nestjs/core",
    "apollo-server"
  ]);
}

function hasAnyDependency(dependencies, names) {
  return names.some((name) => Boolean(dependencies[name]));
}

function scriptIncludes(scripts, keyword) {
  return Object.values(scripts || {}).some(
    (script) => typeof script === "string" && script.includes(keyword)
  );
}

module.exports = { parseSourceFile };
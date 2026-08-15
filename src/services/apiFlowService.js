const fs = require("fs");
const path = require("path");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const supportedExtensions = [".js", ".jsx", ".ts", ".tsx"];

function analyzeEntryPointApiFlow({ folderPath, entryFile = "src/server.js", userStory = null }) {
  const projectRoot = path.resolve(folderPath);
  const entryFilePath = path.resolve(projectRoot, entryFile);

  if (!fs.existsSync(projectRoot)) {
    return {
      success: false,
      message: "Folder does not exist",
      folderPath: projectRoot
    };
  }

  if (!fs.existsSync(entryFilePath)) {
    return {
      success: false,
      message: "Entry point file does not exist",
      folderPath: projectRoot,
      entryFile: entryFilePath
    };
  }

  const visitedFiles = new Set();
  const reachableFiles = collectReachableFiles(entryFilePath, projectRoot);
  const fileAnalyses = reachableFiles.map((filePath) => analyzeFile(filePath, projectRoot));
  const mountedRoutes = fileAnalyses.flatMap((analysis) => getMountedRoutes(analysis));
  const directEntryRoutes = fileAnalyses.flatMap((analysis) => getDirectEntryRoutes(analysis));

  const mountedApiFlows = mountedRoutes.flatMap((mount) => {
    const routeFilePath = resolveImportPath(mount.filePath, mount.routeSource);

    if (!routeFilePath) {
      return [
        {
          basePath: mount.path,
          routeFile: null,
          warning: "Route file could not be resolved",
          steps: [createMountStep(entryFilePath, mount)]
        }
      ];
    }

    return traceRouteFile({
      projectRoot,
      routeFilePath,
      mount,
      visitedFiles
    });
  });
  const directApiFlows = directEntryRoutes.map((route) =>
    createDirectEntryRouteFlow(route.filePath, route)
  );
  const apiFlows = [...directApiFlows, ...mountedApiFlows];

  return {
    success: true,
    status: "API_FLOW_ANALYZED",
    message: "Entry point API flow analyzed successfully",
    folderPath: projectRoot,
    entryFile: entryFilePath,
    userStory,
    totalApis: apiFlows.length,
    apiFlows
  };
}

function collectReachableFiles(entryFilePath, projectRoot, visited = new Set()) {
  if (visited.has(entryFilePath)) {
    return [];
  }

  visited.add(entryFilePath);

  const analysis = analyzeFile(entryFilePath, projectRoot);
  const childFiles = [];

  analysis.imports.forEach((source) => {
    const resolvedPath = resolveImportPath(entryFilePath, source);

    if (resolvedPath && resolvedPath.startsWith(projectRoot)) {
      childFiles.push(
        ...collectReachableFiles(resolvedPath, projectRoot, visited)
      );
    }
  });

  return [entryFilePath, ...childFiles];
}

function traceRouteFile({ projectRoot, routeFilePath, mount, visitedFiles }) {
  const routeAnalysis = analyzeFile(routeFilePath, projectRoot);
  const controllerImports = mapControllerImports(routeFilePath, routeAnalysis.imports);

  if (visitedFiles.has(routeFilePath)) {
    return [];
  }

  visitedFiles.add(routeFilePath);

  return routeAnalysis.routes.map((route) => {
    const handlerName = getControllerHandlerName(route.handlers);
    const controllerImportName = getHandlerImportName(handlerName);
    const controllerFunctionName = getHandlerFunctionName(handlerName);
    const controllerFilePath = controllerImportName
      ? controllerImports.get(controllerImportName) || null
      : null;
    const dependencyTree = controllerFilePath
      ? traceFunctionDependencies({
          filePath: controllerFilePath,
          projectRoot,
          functionName: controllerFunctionName,
          visited: new Set()
        })
      : null;

    return {
      method: route.method,
      path: joinApiPath(mount.path, route.path),
      basePath: mount.path,
      routePath: route.path,
      routeFile: routeFilePath,
      controllerFile: controllerFilePath,
      handlerName: controllerFunctionName,
      displayName: handlerName
        ? `${route.method} ${joinApiPath(mount.path, route.path)} -> ${controllerFunctionName}`
        : `${route.method} ${joinApiPath(mount.path, route.path)}`,
      steps: [
        createMountStep(mount.filePath, mount),
        {
          type: "route",
          filePath: routeFilePath,
          line: route.line,
          text: `${route.method} ${route.path}`,
          handlerName: controllerFunctionName
        },
        ...(controllerFilePath
          ? [
              {
                type: "controller",
                filePath: controllerFilePath,
                functionName: controllerFunctionName
              }
            ]
          : [])
      ],
      dependencyTree
    };
  });
}

function getControllerHandlerName(handlers) {
  if (!handlers || handlers.length === 0) {
    return null;
  }

  return handlers[handlers.length - 1];
}

function getHandlerImportName(handlerName) {
  if (!handlerName) {
    return null;
  }

  return handlerName.split(".")[0];
}

function getHandlerFunctionName(handlerName) {
  if (!handlerName) {
    return null;
  }

  const parts = handlerName.split(".");
  return parts[parts.length - 1];
}

function traceFunctionDependencies({ filePath, projectRoot, functionName, visited }) {
  const visitKey = `${filePath}:${functionName}`;

  if (visited.has(visitKey)) {
    return {
      filePath,
      functionName,
      repeated: true,
      dependencies: []
    };
  }

  visited.add(visitKey);

  const analysis = analyzeFile(filePath, projectRoot);
  const functionInfo = analysis.functions.get(functionName);

  if (!functionInfo) {
    return {
      filePath,
      functionName,
      found: false,
      dependencies: []
    };
  }

  const dependencies = Array.from(functionInfo.calls)
    .map((callName) => {
      const localFunction = analysis.functions.get(callName);

      if (localFunction) {
        return traceFunctionDependencies({
          filePath,
          projectRoot,
          functionName: callName,
          visited
        });
      }

      const importedFilePath = getImportedFunctionFilePath({
        filePath,
        imports: analysis.imports,
        functionName: callName
      });

      if (importedFilePath) {
        return traceFunctionDependencies({
          filePath: importedFilePath,
          projectRoot,
          functionName: callName,
          visited
        });
      }

      return {
        functionName: callName,
        external: true,
        dependencies: []
      };
    })
    .filter(Boolean);

  return {
    filePath,
    functionName,
    startLine: functionInfo.startLine,
    endLine: functionInfo.endLine,
    dependencies
  };
}

function analyzeFile(filePath, projectRoot) {
  const code = fs.readFileSync(filePath, "utf-8");
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

  const imports = new Map();
  const routes = [];
  const mounts = [];
  const functions = new Map();
  const functionStack = [];

  traverse(ast, {
    VariableDeclarator(pathNode) {
      const node = pathNode.node;

      if (isRequireCall(node.init)) {
        const source = node.init.arguments[0].value;
        getImportNames(node.id).forEach((name) => {
          imports.set(name, source);
        });
      }

      const functionName = getFunctionNameFromVariable(node);

      if (functionName) {
        registerFunction(functions, functionName, node.init);
      }
    },

    FunctionDeclaration: {
      enter(pathNode) {
        const functionName = pathNode.node.id?.name || "anonymous";
        registerFunction(functions, functionName, pathNode.node);
        functionStack.push(functionName);
      },
      exit() {
        functionStack.pop();
      }
    },

    FunctionExpression: {
      enter(pathNode) {
        const functionName = getParentFunctionName(pathNode) || "anonymous";
        registerFunction(functions, functionName, pathNode.node);
        functionStack.push(functionName);
      },
      exit() {
        functionStack.pop();
      }
    },

    ArrowFunctionExpression: {
      enter(pathNode) {
        const functionName = getParentFunctionName(pathNode) || "anonymous";
        registerFunction(functions, functionName, pathNode.node);
        functionStack.push(functionName);
      },
      exit() {
        functionStack.pop();
      }
    },

    CallExpression(pathNode) {
      const calleeName = getCalledName(pathNode.node.callee);
      const currentFunction = functionStack[functionStack.length - 1];

      if (currentFunction && calleeName) {
        const functionInfo = functions.get(currentFunction);

        if (functionInfo && !isNoiseCall(calleeName)) {
          functionInfo.calls.add(calleeName.split(".").pop());
        }
      }

      const routeInfo = getRouteInfo(pathNode.node, filePath);

      if (routeInfo) {
        routes.push(routeInfo);
      }

      const mountInfo = getMountInfo(pathNode.node, imports, filePath);

      if (mountInfo) {
        mounts.push(mountInfo);
      }
    }
  });

  return {
    filePath,
    relativePath: path.relative(projectRoot, filePath),
    imports,
    routes,
    mounts,
    functions
  };
}

function getMountedRoutes(entryAnalysis) {
  return entryAnalysis.mounts.filter((mount) => mount.routeSource);
}

function getDirectEntryRoutes(entryAnalysis) {
  return entryAnalysis.routes.filter((route) => route.routeObject === "app");
}

function getMountInfo(callNode, imports, filePath) {
  const calleeName = getCalledName(callNode.callee);

  if (calleeName !== "app.use") {
    return null;
  }

  const [pathArg, routeArg] = callNode.arguments || [];

  if (!pathArg || pathArg.type !== "StringLiteral" || !routeArg) {
    return null;
  }

  const routeVariable = getCalledName(routeArg);

  if (!routeVariable || !imports.has(routeVariable)) {
    return null;
  }

  return {
    filePath,
    line: callNode.loc?.start?.line || null,
    path: pathArg.value,
    routeVariable,
    routeSource: imports.get(routeVariable)
  };
}

function getRouteInfo(callNode, filePath) {
  const callee = callNode.callee;

  if (!callee || callee.type !== "MemberExpression") {
    return null;
  }

  const objectName = getCalledName(callee.object);
  const method = getPropertyName(callee.property);
  const httpMethods = ["get", "post", "put", "patch", "delete"];

  if (!["app", "router"].includes(objectName) || !httpMethods.includes(method)) {
    return null;
  }

  const [pathArg, ...handlers] = callNode.arguments || [];

  if (!pathArg || pathArg.type !== "StringLiteral") {
    return null;
  }

  return {
    filePath,
    line: callNode.loc?.start?.line || null,
    routeObject: objectName,
    method: method.toUpperCase(),
    path: pathArg.value,
    handlers: handlers.map((handler) => getCalledName(handler)).filter(Boolean)
  };
}

function createDirectEntryRouteFlow(entryFilePath, route) {
  return {
    method: route.method,
    path: route.path,
    basePath: "",
    routePath: route.path,
    routeFile: entryFilePath,
    controllerFile: null,
    handlerName: route.handlers[0] || "inline-handler",
    displayName: `${route.method} ${route.path} -> inline-handler`,
    steps: [
      {
        type: "entry-point-api",
        filePath: entryFilePath,
        line: route.line,
        text: `${route.method} ${route.path}`,
        handlerName: route.handlers[0] || "inline-handler"
      }
    ],
    dependencyTree: null
  };
}

function mapControllerImports(routeFilePath, imports) {
  const controllerImports = new Map();

  imports.forEach((source, localName) => {
    const resolvedPath = resolveImportPath(routeFilePath, source);

    if (resolvedPath) {
      controllerImports.set(localName, resolvedPath);
    }
  });

  return controllerImports;
}

function getImportedFunctionFilePath({ filePath, imports, functionName }) {
  if (!imports.has(functionName)) {
    return null;
  }

  return resolveImportPath(filePath, imports.get(functionName));
}

function resolveImportPath(fromFilePath, importSource) {
  if (!importSource || !importSource.startsWith(".")) {
    return null;
  }

  const basePath = path.resolve(path.dirname(fromFilePath), importSource);
  const candidates = [
    basePath,
    ...supportedExtensions.map((extension) => `${basePath}${extension}`),
    ...supportedExtensions.map((extension) => path.join(basePath, `index${extension}`))
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createMountStep(filePath, mount) {
  return {
    type: "entry-point",
    filePath,
    line: mount.line,
    text: `app.use("${mount.path}", ${mount.routeVariable})`,
    routeSource: mount.routeSource
  };
}

function registerFunction(functions, functionName, node) {
  if (!functionName || functions.has(functionName)) {
    return;
  }

  functions.set(functionName, {
    functionName,
    startLine: node.loc?.start?.line || null,
    endLine: node.loc?.end?.line || null,
    calls: new Set()
  });
}

function getFunctionNameFromVariable(node) {
  if (!node || !node.init) {
    return null;
  }

  if (
    node.init.type === "FunctionExpression" ||
    node.init.type === "ArrowFunctionExpression"
  ) {
    return getDeclarationName(node.id);
  }

  return null;
}

function getParentFunctionName(pathNode) {
  const parent = pathNode.parent;

  if (!parent) {
    return null;
  }

  if (parent.type === "VariableDeclarator") {
    return getDeclarationName(parent.id);
  }

  if (parent.type === "ObjectProperty") {
    return getPropertyName(parent.key);
  }

  return null;
}

function getImportNames(node) {
  if (!node) {
    return [];
  }

  if (node.type === "Identifier") {
    return [node.name];
  }

  if (node.type === "ObjectPattern") {
    return node.properties
      .map((property) => {
        if (property.type !== "ObjectProperty") {
          return null;
        }

        return getDeclarationName(property.value) || getPropertyName(property.key);
      })
      .filter(Boolean);
  }

  return [];
}

function isRequireCall(node) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments?.[0]?.type === "StringLiteral"
  );
}

function getDeclarationName(node) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  return null;
}

function getCalledName(node) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "MemberExpression") {
    const objectName = getCalledName(node.object);
    const propertyName = getPropertyName(node.property);

    if (objectName && propertyName) {
      return `${objectName}.${propertyName}`;
    }

    return propertyName || objectName;
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

function isNoiseCall(calleeName) {
  return [
    "res.status",
    "res.json",
    "console.log",
    "console.error",
    "path.resolve",
    "fs.existsSync",
    "fs.statSync"
  ].includes(calleeName);
}

function joinApiPath(basePath, routePath) {
  if (routePath === "/") {
    return basePath;
  }

  return `${basePath.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
}

module.exports = {
  analyzeEntryPointApiFlow
};

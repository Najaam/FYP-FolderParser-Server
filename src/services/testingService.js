const fs = require("fs");
const { analyzeEntryPointApiFlow } = require("./apiFlowService");
const {
  addAnalysis,
  getAllAnalyses,
  updateAnalysis
} = require("./userStoryAnalysisService");
const { resolveUserStory } = require("./testingSessionService");

function startTestingFlow({ folderPath, entryFile, userStory, moduleIndex = 0 }) {
  const sessionUserStory = resolveUserStory({
    folderPath,
    entryFile,
    moduleIndex,
    userStory
  });

  const apiFlow = analyzeEntryPointApiFlow({
    folderPath,
    entryFile,
    userStory: sessionUserStory || null
  });

  if (!apiFlow.success) {
    return apiFlow;
  }

  const modules = createTestingModules(apiFlow.apiFlows);

  if (modules.length === 0) {
    return {
      success: true,
      status: "NO_TESTABLE_MODULES_FOUND",
      message: "No mounted route modules were found from app.use.",
      folderPath: apiFlow.folderPath,
      entryFile: apiFlow.entryFile,
      totalModules: 0,
      totalApis: 0,
      overallTotalApis: apiFlow.totalApis,
      analysisTargets: [],
      apiFlows: []
    };
  }

  const currentModuleIndex = normalizeModuleIndex(moduleIndex, modules.length);
  const currentModule = modules[currentModuleIndex];
  const totalTestableApis = modules.reduce(
    (total, moduleInfo) => total + moduleInfo.apiFlows.length,
    0
  );
  const rawAnalysisTargets = currentModule.apiFlows.map((flow) =>
    createAnalysisTarget(flow)
  );
  const analysisTargets = rawAnalysisTargets.map(toPublicAnalysisTarget);
  const nextModule = modules[currentModuleIndex + 1] || null;

  if (!sessionUserStory) {
    return {
      success: true,
      status: "USER_STORY_REQUIRED",
      message: `${currentModule.moduleName} module found. Enter the user rules for this module.`,
      folderPath: apiFlow.folderPath,
      entryFile: apiFlow.entryFile,
      moduleIndex: currentModuleIndex,
      totalModules: modules.length,
      hasNextModule: Boolean(nextModule),
      currentModule: toPublicTestingModule(currentModule),
      nextModule: nextModule ? toPublicTestingModule(nextModule) : null,
      totalApis: currentModule.apiFlows.length,
      overallTotalApis: totalTestableApis,
      analysisTargets,
      apiFlows: currentModule.apiFlows
    };
  }

  const analyzedFunctions = rawAnalysisTargets
    .filter((target) => target.functionCode)
    .map((target) => {
      const analysis = addAnalysis({
        userStory: sessionUserStory,
        functionCode: target.functionCode
      });

      return {
        id: analysis.id,
        functionName: analysis.functionName,
        method: target.method,
        route: target.route,
        displayName: target.displayName,
        controllerFile: target.controllerFile,
        startLine: target.startLine,
        endLine: target.endLine,
        functionCode: target.functionCode,
        status: analysis.status,
        message: `${analysis.functionName} successfully analyzed`
      };
    });

  const status = nextModule
    ? "MODULE_TESTING_ANALYSIS_COMPLETE"
    : "TESTING_ANALYSIS_COMPLETE";

  return {
    success: true,
    status,
    message:
      analyzedFunctions.length === 1
        ? `${analyzedFunctions[0].functionName} successfully analyzed`
        : `${analyzedFunctions.length} ${currentModule.moduleName} functions successfully analyzed`,
    folderPath: apiFlow.folderPath,
    entryFile: apiFlow.entryFile,
    userStory: sessionUserStory,
    moduleIndex: currentModuleIndex,
    totalModules: modules.length,
    hasNextModule: Boolean(nextModule),
    currentModule: toPublicTestingModule(currentModule),
    nextModule: nextModule ? toPublicTestingModule(nextModule) : null,
    totalApis: currentModule.apiFlows.length,
    overallTotalApis: totalTestableApis,
    analyzedFunctions,
    apiFlows: currentModule.apiFlows
  };
}

function createTestingModules(apiFlows) {
  const moduleMap = new Map();

  apiFlows
    .filter((flow) => flow.basePath && flow.basePath !== "/")
    .forEach((flow) => {
      const moduleKey = `${flow.basePath}:${flow.routeFile || ""}`;
      const mountStep = flow.steps?.find((step) => step.type === "entry-point");

      if (!moduleMap.has(moduleKey)) {
        moduleMap.set(moduleKey, {
          moduleKey,
          moduleName: getModuleName(flow.basePath),
          basePath: flow.basePath,
          routeFile: flow.routeFile,
          routeSource: mountStep?.routeSource || null,
          mountLine: mountStep?.line || null,
          apiFlows: []
        });
      }

      moduleMap.get(moduleKey).apiFlows.push(flow);
    });

  return Array.from(moduleMap.values())
    .sort((first, second) => {
      if (first.mountLine === null) return 1;
      if (second.mountLine === null) return -1;
      return first.mountLine - second.mountLine;
    })
    .map((moduleInfo, index) => ({
      ...moduleInfo,
      moduleIndex: index
    }));
}

function normalizeModuleIndex(moduleIndex, totalModules) {
  const numericIndex = Number(moduleIndex);

  if (!Number.isInteger(numericIndex) || numericIndex < 0) {
    return 0;
  }

  if (numericIndex >= totalModules) {
    return totalModules - 1;
  }

  return numericIndex;
}

function getModuleName(basePath) {
  const lastSegment = String(basePath || "module")
    .split("/")
    .filter(Boolean)
    .pop();

  if (!lastSegment) {
    return "Module";
  }

  return lastSegment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toPublicTestingModule(moduleInfo) {
  const firstEndpoint = createFirstEndpointInfo(moduleInfo.apiFlows[0]);

  return {
    moduleIndex: moduleInfo.moduleIndex,
    moduleName: moduleInfo.moduleName,
    basePath: moduleInfo.basePath,
    routeFile: moduleInfo.routeFile,
    routeSource: moduleInfo.routeSource,
    mountLine: moduleInfo.mountLine,
    totalApis: moduleInfo.apiFlows.length,
    firstEndpoint,
    functionNames: moduleInfo.apiFlows
      .map((flow) => flow.handlerName)
      .filter(Boolean)
  };
}

function createFirstEndpointInfo(flow) {
  if (!flow) {
    return null;
  }

  return {
    method: flow.method,
    path: flow.path,
    routePath: flow.routePath,
    routeFile: flow.routeFile,
    controllerFile: flow.controllerFile,
    functionName: flow.handlerName || null,
    controllerFunction: getControllerFunctionDisplayName(flow),
    displayName: flow.displayName
  };
}

function getControllerFunctionDisplayName(flow) {
  if (!flow?.handlerName) {
    return null;
  }

  const controllerName = getFileBaseName(flow.controllerFile);

  return controllerName
    ? `${controllerName}.${flow.handlerName}`
    : flow.handlerName;
}

function getFileBaseName(filePath) {
  if (!filePath) {
    return null;
  }

  const fileName = filePath.split(/[\\/]/).pop();
  return fileName ? fileName.replace(/\.[^.]+$/, "") : null;
}

function createAnalysisTarget(flow) {
  const controllerNode = findControllerNode(flow.dependencyTree);
  const functionCode = controllerNode ? readFunctionCode(controllerNode) : null;

  return {
    method: flow.method,
    route: flow.path,
    displayName: flow.displayName,
    functionName: controllerNode?.functionName || flow.handlerName || null,
    controllerFile: controllerNode?.filePath || flow.controllerFile || null,
    startLine: controllerNode?.startLine || null,
    endLine: controllerNode?.endLine || null,
    needsUserStory: Boolean(functionCode),
    functionCode
  };
}

function toPublicAnalysisTarget(target) {
  return {
    method: target.method,
    route: target.route,
    displayName: target.displayName,
    functionName: target.functionName,
    controllerFile: target.controllerFile,
    startLine: target.startLine,
    endLine: target.endLine,
    needsUserStory: target.needsUserStory
  };
}

function findControllerNode(node) {
  if (!node || node.found === false || node.external) {
    return null;
  }

  if (node.filePath && node.functionName && node.startLine && node.endLine) {
    return node;
  }

  for (const dependency of node.dependencies || []) {
    const match = findControllerNode(dependency);

    if (match) {
      return match;
    }
  }

  return null;
}

function readFunctionCode(target) {
  if (!target?.filePath || !target.startLine || !target.endLine) {
    return null;
  }

  if (!fs.existsSync(target.filePath)) {
    return null;
  }

  const lines = fs.readFileSync(target.filePath, "utf-8").split(/\r?\n/);
  return lines.slice(target.startLine - 1, target.endLine).join("\n");
}

module.exports = {
  startTestingFlow,
  getAllTestingAnalyses: getAllAnalyses,
  updateTestingAnalysis: updateAnalysis
};

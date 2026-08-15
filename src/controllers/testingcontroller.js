const {
  writeSourceFile,
  writeTestFile,
  writeFeatureFile
} = require("../services/sandboxFileService");

const { runJestTests } = require("../services/sandboxJestService");
const { streamDeepSeekCompletion } = require("../services/deepSeekStreamingService");

const {
  startTestingFlow,
  getAllTestingAnalyses,
  updateTestingAnalysis
} = require("../services/testingService");

const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";

const DEEPSEEK_API_KEY =
  process.env.deepseek_model_api || process.env.DEEPSEEK_API_KEY;

const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

function createPublicError(title, error, suggestedFix = "Please try again after checking the supplied information.") {
  const message = String(error?.message || "");
  const missingApiKey = /api key is missing/i.test(message);
  return {
    title,
    description: missingApiKey ? "The AI service is not configured for this server." : "The requested operation could not be completed.",
    rootCause: missingApiKey ? "Missing AI service configuration." : "The AI service or request could not be processed.",
    suggestedFix: missingApiKey ? "Configure the DeepSeek API key and retry." : suggestedFix,
    severity: missingApiKey ? "High" : "Medium"
  };
}
/* =========================================================
   JSON EXTRACTION
   ========================================================= */

function extractJsonArray(text) {
  if (!text) return [];

  const cleanedText = String(text)
    .replace(/```json/g, "")
    .replace(/```js/g, "")
    .replace(/```javascript/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleanedText);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (Array.isArray(parsed.testCases)) {
      return parsed.testCases;
    }

    return [];
  } catch {
    const match = cleanedText.match(/\[[\s\S]*\]/);

    if (!match) {
      return [];
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
}

/* =========================================================
   TESTING FLOW CONTROLLERS
   ========================================================= */

function startTesting(req, res) {
  try {
    const { folderPath, entryFile, userStory, moduleIndex } = req.body;

    if (!folderPath) {
      return res.status(400).json({
        success: false,
        status: "TESTING_FAILED",
        message: "folderPath is required"
      });
    }

    const result = startTestingFlow({
      folderPath,
      entryFile,
      userStory,
      moduleIndex
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Start testing error:", error);

    return res.status(500).json({
      success: false,
      status: "TESTING_FAILED",
      message: "Internal server error while starting testing flow",
      error: error.message
    });
  }
}

function fetchTestingAnalyses(req, res) {
  return res.status(200).json({
    success: true,
    status: "TESTING_ANALYSES_FETCHED",
    message: "Testing analyses fetched successfully",
    result: getAllTestingAnalyses()
  });
}

function modifyTestingAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { userStory, functionCode } = req.body;

    if (userStory === undefined && functionCode === undefined) {
      return res.status(400).json({
        success: false,
        message: "userStory or functionCode is required"
      });
    }

    const analysis = updateTestingAnalysis(id, {
      userStory,
      functionCode
    });

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: "Analysis not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: `${analysis.functionName} successfully analyzed`,
      functionName: analysis.functionName,
      result: analysis
    });
  } catch (error) {
    console.error("Modify testing analysis error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error while modifying testing analysis",
      error: error.message
    });
  }
}

/* =========================================================
   FEATURE FILE GENERATION
   ========================================================= */

async function generateModuleFeatureFile(req, res) {
  const abortController = new AbortController();
  let responseClosed = false;

  const sendEvent = (event, payload) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const {
      moduleName,
      userStory,
      currentModule = null,
      functions = [],
      apiFlows = []
    } = req.body;

    if (!moduleName || !userStory) {
      return res.status(400).json({ success: false, message: "moduleName and userStory are required", error: {} });
    }

    if (String(moduleName).length > 120 || String(userStory).length > 8000) {
      return res.status(400).json({ success: false, message: "Module name or user rules are too long.", error: {} });
    }

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
    res.on("close", () => {
      responseClosed = true;
      abortController.abort();
    });
    sendEvent("start", { success: true, message: "Feature file generation started", data: {} });

    const prompt = buildFeatureFilePrompt({
      moduleName,
      userStory,
      currentModule,
      functions,
      apiFlows
    });

    let streamedContent = "";
    for await (const content of streamDeepSeekCompletion(prompt, 0.2, abortController.signal)) {
      if (responseClosed) return;
      streamedContent += content;
      sendEvent("chunk", { success: true, message: "Feature file content received", data: { content } });
    }

    const featureFile = normalizeFeatureFile(streamedContent);

    if (!featureFile.trim()) {
      throw new Error("DeepSeek did not return a valid feature file");
    }

    const featureFilePath = writeFeatureFile(featureFile);

    if (!responseClosed) sendEvent("complete", {
      success: true,
      message: `${moduleName} feature file created successfully`,
      data: { moduleName, sandbox: true, featureFilePath }
    });
  } catch (error) {
    console.error("Generate module feature file error:", error);
    if (!responseClosed && error.name !== "AbortError") {
      sendEvent("error", { success: false, message: "Feature File generation failed.", error: createPublicError("Feature File Generation Failed", error, "Review the user rules and retry the feature generation.") });
    }
  } finally {
    if (res.headersSent && !responseClosed) res.end();
  }
}

function buildFeatureFilePrompt({
  moduleName,
  userStory,
  currentModule,
  functions,
  apiFlows
}) {
  const moduleInfo = currentModule
    ? JSON.stringify(
        {
          moduleName: currentModule.moduleName,
          basePath: currentModule.basePath,
          routeFile: currentModule.routeFile,
          totalApis: currentModule.totalApis,
          functionNames: currentModule.functionNames
        },
        null,
        2
      )
    : "not provided";

  const functionSummary = (functions || [])
    .map((functionItem, index) => {
      return [
        `Function ${index + 1}: ${functionItem.functionName || "Unknown"}`,
        `Method: ${functionItem.method || ""}`,
        `Route: ${functionItem.route || ""}`,
        `Controller File: ${functionItem.controllerFile || ""}`,
        "Function Code:",
        truncateForPrompt(
          functionItem.functionCode || functionItem.code || "",
          2200
        )
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const apiSummary = (apiFlows || [])
    .slice(0, 20)
    .map((flow, index) => {
      return `${index + 1}. ${flow.method || ""} ${
        flow.path || flow.routePath || ""
      } -> ${flow.displayName || flow.handlerName || ""}`;
    })
    .join("\n");

  return `
You are a senior QA analyst and BDD feature-file writer.

Create a clean, human-readable Gherkin .feature file for this backend module.
The feature file will be reviewed and approved by the user before Jest test cases are generated.

Module Name: ${moduleName}

User Rules / Business Rules:
${userStory}

Module Info:
${moduleInfo}

API Summary:
${apiSummary || "not provided"}

Controller Functions:
${functionSummary || "not provided"}

Very important rules:
- Return ONLY the feature file text.
- Do not return markdown fences.
- Start with: Feature: ${moduleName}
- Write human-readable scenarios using Given / When / Then.
- Include only behavior supported by the user rules and visible controller logic.
- Do NOT invent database fields, validations, status codes, or responses that are not visible.
- Cover success paths, validation errors, service failures, and role/rule-based behavior from the user rules.
- Keep scenario names simple and understandable for a non-technical reviewer.
- Mention the relevant function or endpoint when useful.
- This feature file must be detailed enough for another AI call to generate Jest test cases from it.
`;
}

function normalizeFeatureFile(text = "") {
  const cleaned = String(text || "")
    .replace(/^```(?:gherkin|feature|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (/^Feature:/i.test(cleaned)) {
    return cleaned;
  }

  return `Feature: Generated Module Behavior\n\n${cleaned}`;
}

function truncateForPrompt(value = "", maxLength = 2000) {
  const text = String(value || "");

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n// ... truncated for prompt size ...`;
}

/* =========================================================
   TEST CASE GENERATION
   ========================================================= */

async function generateFunctionTests(req, res) {
  try {
    const {
      moduleName,
      functionName,
      functionCode,
      controllerFile,
      route,
      method,
      featureFile,
      language = "javascript"
    } = req.body;

    if (!moduleName || !functionName) {
      return res.status(400).json({
        success: false,
        message: "moduleName and functionName are required"
      });
    }

    const prompt = buildTestGenerationPrompt({
      moduleName,
      functionName,
      functionCode,
      controllerFile,
      route,
      method,
      featureFile,
      language
    });

    const data = await askDeepSeek(prompt, 0.15);

    let testCases = normalizeGeneratedTestCases(
      extractJsonArray(data.response)
    ).slice(0, 10);

    if (!testCases.length) {
      const retryPrompt = buildRetryPrompt({
        moduleName,
        functionName,
        functionCode,
        featureFile,
        language
      });

      const retryData = await askDeepSeek(retryPrompt, 0.05);

      testCases = normalizeGeneratedTestCases(
        extractJsonArray(retryData.response)
      ).slice(0, 10);
    }

    if (!testCases.length) {
      return res.status(500).json({
        success: false,
        message: "Ollama did not return valid test cases"
      });
    }

    const sandboxFiles = writeGeneratedTestsToSandbox({
      moduleName,
      functionName,
      functionCode,
      testCases
    });

    return res.status(200).json({
      success: true,
      status: "TEST_CASES_GENERATED",
      message: `${functionName} test cases generated successfully`,
      moduleName,
      functionName,
      controllerFile: controllerFile || null,
      route: route || null,
      method: method || null,
      featureFileUsed: Boolean(featureFile),
      sandbox: true,
      sourceFilePath: sandboxFiles.sourceFilePath,
      testFilePath: sandboxFiles.testFilePath,
      testCases
    });
  } catch (error) {
    console.error("Generate function tests error:", error);

    return res.status(500).json({
      success: false,
      status: "TEST_CASE_GENERATION_FAILED",
      message:
        error.message || "Internal server error while generating test cases",
      error: createPublicError("Test Case Generation Failed", error, "Review the feature file and function details, then retry test case generation.")
    });
  }
}

function buildTestGenerationPrompt({
  moduleName,
  functionName,
  functionCode,
  controllerFile,
  route,
  method,
  featureFile,
  language
}) {
  return `
You are a senior Jest test case generator.

Generate 8 to 10 practical Jest test cases for the exact function below.

Module Name: ${moduleName}
Function Name: ${functionName}
Language: ${language}
Controller/Source File: ${controllerFile || "not provided"}
Route: ${method || ""} ${route || ""}

Function Code:
${functionCode || "Function code not provided. Generate safe generic tests based on function name and module name."}

Approved Feature File:
${featureFile || "No approved feature file provided. Use only the function code and route metadata."}

Very important rules:
- Return ONLY a valid JSON array.
- Do not return markdown.
- Do not return explanation.
- Do not wrap response in backticks.
- JSON must start with [ and end with ].
- Every object must have title, type, description, expectedResult, jestCode.
- The approved feature file is the main testing contract. Generate test cases that match its scenarios.
- Do NOT generate test cases that contradict the approved feature file.
- If the feature file and function code conflict, prefer the visible function code for exact status codes/messages but keep the scenario intent from the feature file.
- jestCode must be a string.
- Do NOT include import or require statements inside jestCode. The test executor will add imports automatically.
- Use the function name directly as ${functionName} inside jestCode.
- Do NOT call ${functionName} through service aliases unless the function code itself does that.
- Do NOT write controller.${functionName} unless controller is visible in the given function code.
- Do NOT invent validations, fields, responses, or behaviors that are not visible in the provided function code.
- If the function is an Express controller with req and res parameters, create mock req/res objects and assert res.status/json calls.
- A helper named createMockResponse() will be available in the generated Jest file.
- A helper named createMockRequest() will be available in the generated Jest file.
- If the function awaits services or external dependencies, use safe mocks/stubs where needed.
- Keep each jestCode block self-contained except for imports.

Return this exact JSON array format:
[
  {
    "title": "should handle valid request successfully",
    "type": "success",
    "description": "Checks successful function behavior",
    "expectedResult": "Function should return successful response",
    "jestCode": "test('should handle valid request successfully', async () => { expect(true).toBe(true); })"
  }
]
`;
}

function buildRetryPrompt({
  moduleName,
  functionName,
  functionCode,
  featureFile,
  language
}) {
  return `
Return ONLY valid JSON array.

Generate exactly 8 Jest test cases for function "${functionName}" in module "${moduleName}".
Language: ${language}

Function Code:
${functionCode || "Function code not provided."}

Approved Feature File:
${featureFile || "No approved feature file provided."}

Rules:
- No markdown.
- No explanation.
- JSON must start with [ and end with ].
- Every test case must have title, type, description, expectedResult, jestCode.
- Use the approved feature file as the main source for scenario intent.
- jestCode must be a string.
- Do NOT include import or require statements.
- Use the function name directly.
- If this is an Express controller, use mock req/res.
- Do NOT invent behavior not present in the function code.

Format:
[
  {
    "title": "should handle valid request successfully",
    "type": "success",
    "description": "Checks successful function behavior",
    "expectedResult": "Function should return successful response",
    "jestCode": "test('should handle valid request successfully', async () => { expect(true).toBe(true); })"
  }
]
`;
}

async function askDeepSeek(prompt, temperature = 0.15) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      "DeepSeek API key is missing. Please add deepseek_model_api in your .env file."
    );
  }

  const deepSeekResponse = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a precise software testing assistant. Return only the exact format requested. Do not add markdown unless explicitly requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature,
      stream: false
    })
  });

  const responseText = await deepSeekResponse.text();

  if (!deepSeekResponse.ok) {
    throw new Error(
      `DeepSeek is not responding properly. Status: ${deepSeekResponse.status}. ${responseText}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`DeepSeek returned invalid JSON response: ${responseText}`);
  }

  return {
    response: data?.choices?.[0]?.message?.content || ""
  };
}

function normalizeGeneratedTestCases(testCases) {
  return (testCases || [])
    .filter((testCase) => testCase && typeof testCase === "object")
    .map((testCase, index) => ({
      title: String(testCase.title || `generated test case ${index + 1}`),
      type: String(testCase.type || "general"),
      description: String(testCase.description || "Generated Jest test case"),
      expectedResult: String(
        testCase.expectedResult || "Expected behavior should be verified"
      ),
      jestCode: String(testCase.jestCode || "").trim()
    }))
    .filter((testCase) => testCase.jestCode);
}

function writeGeneratedTestsToSandbox({
  moduleName,
  functionName,
  functionCode,
  testCases
}) {
  const functionItem = {
    functionName,
    functionCode,
    testCases
  };

  const sourceCode =
    buildSandboxSourceCode({
      functions: [functionItem]
    }) || buildFallbackSandboxSource(functionName);

  const testCode = buildSandboxTestCode({
    moduleName,
    functions: [functionItem]
  });

  const sourceFilePath = writeSourceFile(sourceCode);
  const testFilePath = writeTestFile(testCode);

  return {
    sourceFilePath,
    testFilePath
  };
}

function buildFallbackSandboxSource(functionName) {
  if (!isValidJavaScriptIdentifier(functionName)) {
    return "";
  }

  return [
    "// Auto-generated sandbox source file for DevSure test generation.",
    "// Function code was not provided, so this placeholder will fail if executed.",
    `function ${functionName}() {`,
    `  throw new Error("Function code not provided for sandbox execution.");`,
    "}",
    "",
    `module.exports = { ${functionName} };`
  ].join("\n");
}

/* =========================================================
   EXECUTE MODULE TESTS ONE BY ONE
   ========================================================= */

async function executeModuleTests(req, res) {
  try {
    const { moduleName, functions } = req.body;

    if (!moduleName || !Array.isArray(functions)) {
      return res.status(400).json({
        success: false,
        message: "moduleName and functions are required"
      });
    }

    const executableFunctions = functions
      .map((functionItem) => ({
        ...functionItem,
        testCases: Array.isArray(functionItem.testCases)
          ? functionItem.testCases
          : []
      }))
      .filter(
        (functionItem) =>
          functionItem.functionName && functionItem.testCases.length
      );

    if (!executableFunctions.length) {
      return res.status(400).json({
        success: false,
        message: "At least one function with testCases is required"
      });
    }

    const sourceCode = buildSandboxSourceCode({
      functions: executableFunctions
    });

    if (!sourceCode.trim()) {
      return res.status(400).json({
        success: false,
        message:
          "No functionCode found. Regenerate test cases first so execution can write sandbox/sample.js."
      });
    }

    const sourceFilePath = writeSourceFile(sourceCode);
    let testFilePath = null;

    const individualResults = [];
    const functionResultsMap = new Map();
    const combinedStdout = [];
    const combinedStderr = [];

    for (const functionItem of executableFunctions) {
      const functionName = functionItem.functionName;

      if (!functionResultsMap.has(functionName)) {
        functionResultsMap.set(functionName, {
          functionName,
          passedCount: 0,
          failedCount: 0,
          total: 0,
          testCases: []
        });
      }

      for (let index = 0; index < functionItem.testCases.length; index += 1) {
        const testCase = functionItem.testCases[index];

        const singleTestCode = buildSingleSandboxTestCode({
          moduleName,
          functions: executableFunctions,
          functionItem,
          testCase
        });

        if (!singleTestCode.trim()) {
          const skippedResult = buildSkippedTestCaseResult({
            moduleName,
            functionName,
            testCase,
            index,
            reason: "No executable Jest code found for this test case"
          });

          individualResults.push(skippedResult);

          const functionResult = functionResultsMap.get(functionName);
          functionResult.failedCount += 1;
          functionResult.total += 1;
          functionResult.testCases.push(skippedResult);

          continue;
        }

        testFilePath = writeTestFile(singleTestCode);

        const jestResult = await runJestTests(testFilePath);

        if (jestResult.rawStdout) {
          combinedStdout.push(jestResult.rawStdout);
        }

        if (jestResult.rawStderr) {
          combinedStderr.push(jestResult.rawStderr);
        }

        const normalizedResult = buildIndividualTestCaseResult({
          moduleName,
          functionName,
          testCase,
          index,
          jestResult
        });

        individualResults.push(normalizedResult);

        const functionResult = functionResultsMap.get(functionName);
        functionResult.total += 1;

        if (normalizedResult.passed) {
          functionResult.passedCount += 1;
        } else {
          functionResult.failedCount += 1;
        }

        functionResult.testCases.push(normalizedResult);
      }
    }

    const finalCombinedTestCode = buildSandboxTestCode({
      moduleName,
      functions: executableFunctions
    });

    if (finalCombinedTestCode.trim()) {
      testFilePath = writeTestFile(finalCombinedTestCode);
    }

    const passedTests = individualResults.filter((testCase) => testCase.passed);
    const failedTests = individualResults.filter((testCase) => !testCase.passed);

    const total = individualResults.length;
    const passed = passedTests.length;
    const failed = failedTests.length;
    const allPassed = total > 0 && failed === 0;

    const passPercentage =
      total > 0 ? Math.round((passed / total) * 100) : 0;

    const functionResults = Array.from(functionResultsMap.values()).map(
      (functionResult) => {
        const functionPassPercentage =
          functionResult.total > 0
            ? Math.round(
                (functionResult.passedCount / functionResult.total) * 100
              )
            : 0;

        return {
          functionName: functionResult.functionName,
          passed: functionResult.passedCount,
          failed: functionResult.failedCount,
          total: functionResult.total,
          passPercentage: functionPassPercentage,
          testCases: functionResult.testCases,
          summary: {
            passed: functionResult.passedCount,
            failed: functionResult.failedCount,
            total: functionResult.total,
            passPercentage: functionPassPercentage
          }
        };
      }
    );

    const output = buildAggregateOutput({
      passed,
      failed,
      total,
      allPassed,
      logs: combinedStdout
    });

    const errorOutput = buildAggregateErrorOutput({
      passed,
      failed,
      total,
      allPassed,
      failedTests,
      logs: combinedStderr
    });

    return res.status(200).json({
      success: true,
      passed: allPassed,
      message: allPassed
        ? `${moduleName} tests executed successfully inside backend sandbox`
        : `${moduleName} tests executed individually inside backend sandbox but some tests failed`,
      sandbox: true,
      sourceFilePath,
      testFilePath,
      output,
      errorOutput,
      testResult: {
        success: allPassed,
        passed,
        failed,
        total,
        rawStdout: output,
        rawStderr: errorOutput,
        testCases: individualResults,
        passedTests,
        failedTests,
        functionResults
      },
      testCases: individualResults,
      testDetails: individualResults,
      passedTests,
      failedTests,
      functionResults,
      passPercentage
    });
  } catch (error) {
    console.error("Execute module tests sandbox error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Internal server error while executing module tests inside backend sandbox",
      error: error.message
    });
  }
}

function buildSingleSandboxTestCode({
  moduleName,
  functions,
  functionItem,
  testCase
}) {
  const functionNames = getUniqueFunctionNames(functions).filter(
    isValidJavaScriptIdentifier
  );

  const dependencies = getSandboxDependencies(functions);
  const cleanCode = cleanJestCode(testCase?.jestCode || "");

  if (!functionNames.length || !cleanCode.trim()) {
    return "";
  }

  return [
    `// Auto-generated by DevSure for module: ${moduleName}`,
    `// Single test execution for function: ${functionItem.functionName}`,
    buildSandboxImportHeader({
      moduleName,
      functionNames,
      dependencies
    }),
    buildCommonTestHelpers(),
    `// Function: ${functionItem.functionName}`,
    cleanCode
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSkippedTestCaseResult({
  moduleName,
  functionName,
  testCase,
  index,
  reason
}) {
  return {
    id: `${sanitizeFileName(moduleName)}-${sanitizeFileName(functionName)}-${
      index + 1
    }`,
    moduleName,
    functionName,
    title: testCase?.title || `Test case ${index + 1}`,
    type: testCase?.type || "general",
    description: testCase?.description || "",
    expectedResult: testCase?.expectedResult || "",
    status: "failed",
    passed: false,
    failed: true,
    duration: 0,
    failureReason: reason,
    failureMessage: reason,
    failureMessages: [reason],
    output: "",
    errorOutput: reason
  };
}

function buildIndividualTestCaseResult({
  moduleName,
  functionName,
  testCase,
  index,
  jestResult
}) {
  const firstDetail =
    Array.isArray(jestResult.testDetails) && jestResult.testDetails.length
      ? jestResult.testDetails[0]
      : null;

  const passed = Boolean(jestResult.success && (jestResult.failed || 0) === 0);

  const fallbackFailure =
    jestResult.rawStderr ||
    "Test failed but Jest did not return a detailed failure message";

  const failureMessage =
    firstDetail?.failureMessage || (passed ? "" : fallbackFailure);

  const failureReason =
    firstDetail?.failureReason ||
    (passed ? "" : extractShortFailureReason(fallbackFailure));

  return {
    id: `${sanitizeFileName(moduleName)}-${sanitizeFileName(functionName)}-${
      index + 1
    }`,
    moduleName,
    functionName,
    title: testCase?.title || firstDetail?.title || `Test case ${index + 1}`,
    fullName:
      firstDetail?.fullName || testCase?.title || `Test case ${index + 1}`,
    type: testCase?.type || "general",
    description: testCase?.description || "",
    expectedResult: testCase?.expectedResult || "",
    status: passed ? "passed" : "failed",
    passed,
    failed: !passed,
    duration: firstDetail?.duration || 0,
    failureReason,
    failureMessage,
    failureMessages:
      firstDetail?.failureMessages || (failureMessage ? [failureMessage] : []),
    output: jestResult.rawStdout || "",
    errorOutput: passed
      ? ""
      : jestResult.rawStderr || failureMessage || failureReason
  };
}

function extractShortFailureReason(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const usefulLines = lines.filter((line) => {
    return (
      line.startsWith("Expected") ||
      line.startsWith("Received") ||
      line.startsWith("Error:") ||
      line.startsWith("TypeError:") ||
      line.startsWith("ReferenceError:") ||
      line.startsWith("SyntaxError:") ||
      line.includes("is not defined") ||
      line.includes("is not a function") ||
      line.includes("Cannot find module") ||
      line.includes("Cannot read")
    );
  });

  return (usefulLines.length ? usefulLines : lines).slice(0, 8).join("\n");
}

function buildAggregateOutput({ passed, failed, total, allPassed, logs }) {
  const summary = [
    allPassed ? "PASS" : "FAIL",
    `Tests: ${passed} passed, ${failed} failed, ${total} total`
  ].join("\n");

  const uniqueLogs = [...new Set((logs || []).filter(Boolean))];

  return [summary, ...uniqueLogs].filter(Boolean).join("\n\n").trim();
}

function buildAggregateErrorOutput({
  passed,
  failed,
  total,
  allPassed,
  failedTests,
  logs
}) {
  const summary = [
    allPassed ? "PASS" : "FAIL",
    `Tests: ${passed} passed, ${failed} failed, ${total} total`
  ];

  if (failedTests.length) {
    summary.push("");
    summary.push("Failed Test Cases:");

    failedTests.forEach((testCase, index) => {
      summary.push(`${index + 1}. [${testCase.functionName}] ${testCase.title}`);

      if (testCase.failureReason) {
        summary.push(
          `   Reason: ${testCase.failureReason.replace(/\n/g, " | ")}`
        );
      }
    });
  }

  const uniqueLogs = [...new Set((logs || []).filter(Boolean))];

  return [...summary, ...uniqueLogs].filter(Boolean).join("\n").trim();
}

/* =========================================================
   SANDBOX SOURCE / TEST BUILDERS
   ========================================================= */

function buildSandboxSourceCode({ functions }) {
  const uniqueFunctionNames = getUniqueFunctionNames(functions);
  const dependencies = getSandboxDependencies(functions);

  const functionCodeBlocks = (functions || [])
    .map((functionItem) => getFunctionCodeForSandbox(functionItem))
    .filter(Boolean)
    .map((code) => normalizeFunctionCodeForSandbox(code))
    .filter(Boolean);

  if (!functionCodeBlocks.length) {
    return "";
  }

  return [
    "// Auto-generated sandbox source file for DevSure test execution.",
    "// This file is written inside the backend project's sandbox folder.",
    "// It is overwritten on every generation/execution.",
    buildSafeDependencyMocks(dependencies),
    functionCodeBlocks.join("\n\n"),
    buildSandboxExports(uniqueFunctionNames, dependencies)
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getFunctionCodeForSandbox(functionItem) {
  if (functionItem?.functionCode) {
    return functionItem.functionCode;
  }

  return "";
}

function normalizeFunctionCodeForSandbox(code) {
  return stripCodeFence(code)
    .replace(/^\s*import\s+.*from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*const\s+.*=\s*require\(["'][^"']+["']\);?\s*$/gm, "")
    .replace(/^\s*let\s+.*=\s*require\(["'][^"']+["']\);?\s*$/gm, "")
    .replace(/^\s*var\s+.*=\s*require\(["'][^"']+["']\);?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(async\s+function\s+)/gm, "$1")
    .replace(/^\s*export\s+(function\s+)/gm, "$1")
    .replace(/^\s*export\s+const\s+/gm, "const ")
    .replace(/^\s*module\.exports\s*=\s*[\s\S]*?;?\s*$/gm, "")
    .replace(/^\s*exports\.[a-zA-Z_$][\w$]*\s*=\s*[\s\S]*?;?\s*$/gm, "")
    .trim();
}

function stripCodeFence(code = "") {
  return String(code)
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

/* =========================================================
   PERMANENT DYNAMIC DEPENDENCY MOCK FIX
   ========================================================= */

function getSandboxDependencies(functions = []) {
  const dependencies = [];
  const functionNames = getUniqueFunctionNames(functions);

  (functions || []).forEach((functionItem) => {
    const code = String(functionItem?.functionCode || "");

    extractRequireDependencies(code).forEach((dependency) =>
      dependencies.push(dependency)
    );

    extractReferencedDependencies(code, functionNames).forEach((dependency) =>
      dependencies.push(dependency)
    );
  });

  const seen = new Set();

  return dependencies.filter((dependency) => {
    if (!dependency.name || !isValidJavaScriptIdentifier(dependency.name)) {
      return false;
    }

    if (seen.has(dependency.name)) {
      return false;
    }

    seen.add(dependency.name);

    return true;
  });
}

function extractRequireDependencies(code = "") {
  const dependencies = [];

  const patterns = [
    /const\s+([a-zA-Z_$][\w$]*)\s*=\s*require\(["'][^"']+["']\);?/g,
    /let\s+([a-zA-Z_$][\w$]*)\s*=\s*require\(["'][^"']+["']\);?/g,
    /var\s+([a-zA-Z_$][\w$]*)\s*=\s*require\(["'][^"']+["']\);?/g,
    /import\s+([a-zA-Z_$][\w$]*)\s+from\s+["'][^"']+["'];?/g
  ];

  patterns.forEach((pattern) => {
    let match;

    while ((match = pattern.exec(code)) !== null) {
      const name = match[1];

      dependencies.push({
        name,
        kind: getDependencyKind(name)
      });
    }
  });

  return dependencies;
}

function extractReferencedDependencies(code = "", functionNames = []) {
  const dependencies = [];
  const functionNameSet = new Set(functionNames || []);

  const servicePattern = /\b([a-zA-Z_$][\w$]*Service)\s*\./g;
  let serviceMatch;

  while ((serviceMatch = servicePattern.exec(code)) !== null) {
    dependencies.push({
      name: serviceMatch[1],
      kind: "service"
    });
  }

  const helperPattern =
    /\b(generateToken|[a-zA-Z_$][\w$]*(?:Token|Helper|Util|Middleware))\s*\(/g;

  let helperMatch;

  while ((helperMatch = helperPattern.exec(code)) !== null) {
    const name = helperMatch[1];

    if (!functionNameSet.has(name)) {
      dependencies.push({
        name,
        kind: "function"
      });
    }
  }

  return dependencies;
}

function getDependencyKind(name = "") {
  if (/service$/i.test(name)) {
    return "service";
  }

  return "function";
}

function buildSafeDependencyMocks(dependencies = []) {
  const dependencyLines = dependencies
    .map((dependency) => {
      if (!isValidJavaScriptIdentifier(dependency.name)) {
        return "";
      }

      if (dependency.kind === "service") {
        return `const ${dependency.name} = createAutoMockService("${dependency.name}");`;
      }

      return `const ${dependency.name} = createAutoMockFunction("${dependency.name}");`;
    })
    .filter(Boolean)
    .join("\n");

  return `
// Safe dynamic dependency mocks for sandbox execution.
// Imported or referenced services/helpers are converted into mocks automatically.

function createMockUser(overrides = {}) {
  return {
    _id: "123",
    id: "123",
    fullName: "John Doe",
    name: "John Doe",
    email: "john@example.com",
    role: "user",
    createdAt: new Date(),
    ...overrides
  };
}

function createMockVenue(overrides = {}) {
  return {
    _id: "venue123",
    id: "venue123",
    name: "Grand Hall",
    description: "A premium event venue",
    location: "Karachi",
    capacity: 200,
    pricePerHour: 5000,
    amenities: ["Parking", "AC", "WiFi"],
    images: ["venue.jpg"],
    createdBy: "user123",
    ...overrides
  };
}

function createMockBooking(overrides = {}) {
  return {
    _id: "booking123",
    id: "booking123",
    venue: "venue123",
    user: "user123",
    date: "2026-01-01",
    startTime: "10:00",
    endTime: "12:00",
    status: "pending",
    totalAmount: 10000,
    ...overrides
  };
}

function createMockPayment(overrides = {}) {
  return {
    _id: "payment123",
    id: "payment123",
    booking: "booking123",
    amount: 10000,
    status: "paid",
    method: "card",
    ...overrides
  };
}

function createDomainMock(serviceName, payload = {}) {
  if (/venue/i.test(serviceName)) {
    return createMockVenue(payload);
  }

  if (/booking/i.test(serviceName)) {
    return createMockBooking(payload);
  }

  if (/payment/i.test(serviceName)) {
    return createMockPayment(payload);
  }

  return createMockUser(payload);
}

function createAutoMockFunction(name) {
  return jest.fn((...args) => {
    if (/token/i.test(name)) {
      return "mock-token";
    }

    if (/id/i.test(name)) {
      return "123";
    }

    if (/hash/i.test(name)) {
      return "mock-hash";
    }

    if (/compare/i.test(name)) {
      return true;
    }

    return "mock-value";
  });
}

function createAutoMockService(serviceName) {
  const serviceTarget = {};

  return new Proxy(serviceTarget, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }

      const methodName = String(property);

      target[property] = jest.fn(async (payload = {}) => {
        const id =
          typeof payload === "string"
            ? payload
            : payload?._id ||
              payload?.id ||
              payload?.userId ||
              payload?.venueId ||
              "123";

        if (/getAll|findAll|list|fetchAll/i.test(methodName)) {
          return [createDomainMock(serviceName)];
        }

        if (/get.*ById|find.*ById|getProfile|profile|details/i.test(methodName)) {
          if (!id || id === "invalid" || id === "not-found") {
            if (/profile/i.test(methodName)) {
              throw new Error("User not found");
            }

            return null;
          }

          return createDomainMock(serviceName, { _id: id, id });
        }

        if (/create|register|add/i.test(methodName)) {
          if (payload?.role === "admin" && /auth/i.test(serviceName)) {
            throw new Error("Invalid role");
          }

          return createDomainMock(serviceName, payload);
        }

        if (/login|signin/i.test(methodName)) {
          if (
            payload?.email === "invalid-email" ||
            payload?.password === "wrong-password"
          ) {
            throw new Error("Authentication failed");
          }

          return createMockUser({
            email: payload?.email || "john@example.com"
          });
        }

        if (/update|edit/i.test(methodName)) {
          if (!id || id === "not-found") {
            if (/venue/i.test(serviceName)) {
              throw new Error("Venue not found");
            }

            throw new Error("Record not found");
          }

          return createDomainMock(serviceName, {
            _id: id,
            id,
            ...payload
          });
        }

        if (/delete|remove/i.test(methodName)) {
          if (!id || id === "not-found") {
            return false;
          }

          return true;
        }

        if (/cancel/i.test(methodName)) {
          if (!id || id === "not-found") {
            throw new Error("Record not found");
          }

          return {
            success: true,
            message: "Cancelled successfully"
          };
        }

        return {
          success: true,
          message: "mock success",
          data: createDomainMock(serviceName, payload)
        };
      });

      return target[property];
    }
  });
}

${dependencyLines}

const fs = {
  promises: {
    readFile: jest.fn(async () => ""),
    writeFile: jest.fn(async () => undefined),
    mkdir: jest.fn(async () => undefined),
    readdir: jest.fn(async () => []),
    stat: jest.fn(async () => ({ isDirectory: () => false, isFile: () => true }))
  },
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isDirectory: () => true, isFile: () => false })),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => "")
};

const path = require("path");

const fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true }),
  text: async () => "mock text"
}));
`;
}

function buildSandboxExports(functionNames, dependencies = []) {
  const validNames = functionNames.filter(isValidJavaScriptIdentifier);

  const dependencyExportLines = dependencies
    .filter((dependency) => isValidJavaScriptIdentifier(dependency.name))
    .map((dependency) => {
      return `
if (typeof ${dependency.name} !== "undefined") {
  module.exports.${dependency.name} = ${dependency.name};
}`;
    })
    .join("\n");

  const exportLines = validNames
    .map((functionName) => {
      return `
if (typeof ${functionName} !== "undefined") {
  module.exports.${functionName} = ${functionName};
}`;
    })
    .join("\n");

  return `
module.exports = module.exports || {};

${dependencyExportLines}

${exportLines}
`;
}

function buildSandboxTestCode({ moduleName, functions }) {
  const functionNames = getUniqueFunctionNames(functions).filter(
    isValidJavaScriptIdentifier
  );

  const dependencies = getSandboxDependencies(functions);
  const bodyCode = buildTestBody(functions);

  if (!functionNames.length || !bodyCode.trim()) {
    return "";
  }

  return [
    `// Auto-generated by DevSure for module: ${moduleName}`,
    "// This file is regenerated when tests are executed inside sandbox.",
    buildSandboxImportHeader({
      moduleName,
      functionNames,
      dependencies
    }),
    buildCommonTestHelpers(),
    bodyCode
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSandboxImportHeader({
  moduleName,
  functionNames,
  dependencies = []
}) {
  const moduleBaseName = getModuleBaseName(moduleName);
  const lowerBaseName = lowerFirst(moduleBaseName);

  const namedImportLine = functionNames.length
    ? `const { ${functionNames.join(", ")} } = sandboxModule;`
    : "";

  const dependencyNames = dependencies
    .filter((dependency) => isValidJavaScriptIdentifier(dependency.name))
    .map((dependency) => dependency.name);

  const dependencyImportLines = dependencyNames.map((dependencyName) => {
    return `const ${dependencyName} = sandboxModule.${dependencyName};`;
  });

  const reservedNames = new Set([
    "sandboxModule",
    "sample",
    ...functionNames,
    ...dependencyNames
  ]);

  const aliasLines = buildUniqueAliasLines(
    [
      "const service = sandboxModule;",
      "const controller = sandboxModule;",
      "const moduleUnderTest = sandboxModule;",
      `const ${lowerBaseName} = sandboxModule;`,
      `const ${lowerBaseName}Service = sandboxModule;`,
      `const ${lowerBaseName}Controller = sandboxModule;`,
      `const ${lowerBaseName}Module = sandboxModule;`
    ],
    reservedNames
  );

  return `
const sandboxModule = require("./sample");
const sample = sandboxModule;

${namedImportLine}

${dependencyImportLines.join("\n")}

// Aliases for AI-generated tests that may use service/controller/module style calls.
${aliasLines}
`;
}

function buildUniqueAliasLines(lines, reservedNames = new Set()) {
  const usedNames = new Set(reservedNames);
  const output = [];

  lines.filter(Boolean).forEach((line) => {
    const match = line.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);

    if (!match) {
      output.push(line);
      return;
    }

    const variableName = match[1];

    if (usedNames.has(variableName)) {
      return;
    }

    usedNames.add(variableName);
    output.push(line);
  });

  return output.join("\n");
}
/* =========================================================
   COMMON TEST HELPERS
   ========================================================= */

function buildCommonTestHelpers() {
  return `
function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis()
  };
}

function createMockRequest(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: {
      _id: "user123",
      id: "user123",
      role: "user"
    },
    ...overrides
  };
}
`;
}

function buildTestBody(functions) {
  return (functions || [])
    .map((functionItem) => {
      const functionName = functionItem.functionName || "anonymousFunction";

      const codes = (functionItem.testCases || [])
        .map((testCase) => cleanJestCode(testCase.jestCode))
        .filter(Boolean)
        .join("\n\n");

      return `// Function: ${functionName}\n${codes}`;
    })
    .join("\n\n");
}

function cleanJestCode(jestCode) {
  if (!jestCode || typeof jestCode !== "string") {
    return "";
  }

  return jestCode
    .replace(
      /jest\.spyOn\(generateToken\)\.mockImplementation/g,
      "generateToken.mockImplementationOnce"
    )
    .replace(
      /jest\.spyOn\(generateToken,\s*['"]generateToken['"]\)\.mockImplementation/g,
      "generateToken.mockImplementationOnce"
    )
    .split(/\r?\n/)
    .filter((line) => !isTopLevelImportOrRequire(line))
    .filter((line) => !line.trim().startsWith("jest.mock("))
    .join("\n")
    .trim();
}

function isTopLevelImportOrRequire(line) {
  const trimmed = line.trim();

  return (
    /^import\s+.+\s+from\s+['"].+['"];?$/.test(trimmed) ||
    /^const\s+.+\s*=\s*require\(['"].+['"]\);?$/.test(trimmed) ||
    /^let\s+.+\s*=\s*require\(['"].+['"]\);?$/.test(trimmed) ||
    /^var\s+.+\s*=\s*require\(['"].+['"]\);?$/.test(trimmed)
  );
}

/* =========================================================
   SMALL UTILITIES
   ========================================================= */

function isValidJavaScriptIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value || ""));
}

function sanitizeFileName(name) {
  return String(name || "test")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .toLowerCase();
}

function getModuleBaseName(moduleName) {
  const cleaned = String(moduleName || "module")
    .replace(/\.[jt]sx?$/i, "")
    .replace(/[^a-zA-Z0-9_$]/g, "");

  const withoutSuffix = cleaned.replace(
    /(controller|controllers|service|services|route|routes|module|modules)$/i,
    ""
  );

  return withoutSuffix || "module";
}

function lowerFirst(value) {
  const text = String(value || "module");

  return text.charAt(0).toLowerCase() + text.slice(1);
}

function getUniqueFunctionNames(functions) {
  return [
    ...new Set(
      (functions || [])
        .map((functionItem) => functionItem?.functionName)
        .filter(Boolean)
    )
  ];
}

/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  startTesting,
  fetchTestingAnalyses,
  modifyTestingAnalysis,
  generateModuleFeatureFile,
  generateFunctionTests,
  executeModuleTests
};

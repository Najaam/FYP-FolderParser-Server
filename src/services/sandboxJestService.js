const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { sandboxDir, testFilePath } = require("./sandboxFileService");

function stripAnsi(text = "") {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizePassFailLine(line = "") {
  const trimmed = line.trim();

  if (trimmed.startsWith("PASS")) return "PASS";
  if (trimmed.startsWith("FAIL")) return "FAIL";

  return line;
}

function cleanJestLogs(text = "") {
  const cleaned = stripAnsi(text);

  return cleaned
    .split("\n")
    .map((line) => normalizePassFailLine(line))
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) return false;
      if (trimmed.includes("Ran all test suites within paths")) return false;
      if (trimmed.includes("Ran all test suites matching")) return false;
      if (trimmed.includes("Test results written to:")) return false;
      if (/^\d+\s*\|/.test(trimmed)) return false;
      if (/^>\s*\d+\s*\|/.test(trimmed)) return false;
      if (/^\|/.test(trimmed)) return false;
      if (/^\^+$/.test(trimmed)) return false;

      return true;
    })
    .join("\n")
    .trim();
}

function cleanFailureMessage(message = "") {
  return cleanJestLogs(message)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractFailureReason(message = "") {
  const cleaned = cleanFailureMessage(message);

  if (!cleaned) {
    return "";
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const importantLines = lines.filter((line) => {
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
      line.includes("Cannot read") ||
      line.includes("toHaveBeenCalledWith") ||
      line.includes("toEqual") ||
      line.includes("toBe")
    );
  });

  return (importantLines.length ? importantLines : lines).slice(0, 8).join("\n");
}

function ensureSandboxDirectory() {
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }
}

function getJestBinPath() {
  const possiblePaths = [
    path.join(sandboxDir, "node_modules", "jest", "bin", "jest.js"),
    path.join(process.cwd(), "node_modules", "jest", "bin", "jest.js")
  ];

  return possiblePaths.find((possiblePath) => fs.existsSync(possiblePath));
}

function createOutputFilePath() {
  const uniqueName = `jest-result-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.json`;

  return path.join(sandboxDir, uniqueName);
}

function readJestResultFile(outputFile) {
  try {
    if (!fs.existsSync(outputFile)) {
      return null;
    }

    const fileContent = fs.readFileSync(outputFile, "utf8");

    if (!fileContent.trim()) {
      return null;
    }

    return JSON.parse(fileContent);
  } catch (error) {
    console.error("Failed to parse Jest result file:", error.message);
    return null;
  }
}

function removeJestResultFile(outputFile) {
  try {
    if (outputFile && fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  } catch {
    // ignore cleanup error
  }
}

function extractTestDetails(parsedResult) {
  const details = [];

  const testResults = Array.isArray(parsedResult?.testResults)
    ? parsedResult.testResults
    : [];

  testResults.forEach((fileResult) => {
    const assertionResults = Array.isArray(fileResult.assertionResults)
      ? fileResult.assertionResults
      : [];

    assertionResults.forEach((assertion, index) => {
      const failureMessages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.map(cleanFailureMessage).filter(Boolean)
        : [];

      const failureMessage = failureMessages.join("\n\n").trim();

      details.push({
        id: `${path.basename(fileResult.name || "sample.test.js")}-${index + 1}`,
        title: assertion.title || "Unnamed test case",
        fullName: assertion.fullName || assertion.title || "Unnamed test case",
        status: assertion.status || "unknown",
        passed: assertion.status === "passed",
        failed: assertion.status === "failed",
        duration: assertion.duration || 0,
        filePath: fileResult.name || "",
        ancestorTitles: assertion.ancestorTitles || [],
        failureMessages,
        failureMessage,
        failureReason: extractFailureReason(failureMessage)
      });
    });
  });

  return details;
}

function buildFallbackResult({ error, stdout, stderr }) {
  const cleanedStdout = cleanJestLogs(stdout);
  const cleanedStderr = cleanFailureMessage(stderr || error?.message || "");
  const fallbackMessage =
    cleanedStderr || cleanedStdout || "Jest output could not be parsed";

  return {
    success: false,
    passed: 0,
    failed: 1,
    total: 1,
    testDetails: [
      {
        id: "sample.test.js-1",
        title: "Jest execution failed",
        fullName: "Jest execution failed",
        status: "failed",
        passed: false,
        failed: true,
        duration: 0,
        filePath: "",
        ancestorTitles: [],
        failureMessages: [fallbackMessage],
        failureMessage: fallbackMessage,
        failureReason: extractFailureReason(fallbackMessage) || fallbackMessage
      }
    ],
    passedTests: [],
    failedTests: [
      {
        id: "sample.test.js-1",
        title: "Jest execution failed",
        fullName: "Jest execution failed",
        status: "failed",
        passed: false,
        failed: true,
        duration: 0,
        filePath: "",
        ancestorTitles: [],
        failureMessages: [fallbackMessage],
        failureMessage: fallbackMessage,
        failureReason: extractFailureReason(fallbackMessage) || fallbackMessage
      }
    ],
    rawStdout: cleanedStdout,
    rawStderr: fallbackMessage
  };
}

function runJestTests(inputTestFilePath) {
  ensureSandboxDirectory();

  const outputFile = createOutputFilePath();
  const exactPath = path.resolve(inputTestFilePath || testFilePath);
  const jestBinPath = getJestBinPath();

  if (!jestBinPath) {
    return Promise.resolve(
      buildFallbackResult({
        error: new Error(
          "Jest is not installed. Run: cd sandbox && npm install --no-audit --no-fund"
        ),
        stdout: "",
        stderr:
          "Jest is not installed inside sandbox. Run: cd sandbox && npm install --no-audit --no-fund"
      })
    );
  }

  const command = process.execPath;

  const args = [
    jestBinPath,
    "--runTestsByPath",
    exactPath,
    "--runInBand",
    "--no-cache",
    "--json",
    "--outputFile",
    outputFile
  ];

  return new Promise((resolve) => {
    let childProcess;

    try {
      childProcess = execFile(
        command,
        args,
        {
          cwd: sandboxDir,
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 10,
          windowsHide: true
        },
        (error, stdout = "", stderr = "") => {
          const parsed = readJestResultFile(outputFile);
          const cleanedStdout = cleanJestLogs(stdout);
          const cleanedStderr = cleanFailureMessage(stderr);

          removeJestResultFile(outputFile);

          if (!parsed) {
            return resolve(
              buildFallbackResult({
                error,
                stdout,
                stderr
              })
            );
          }

          const testDetails = extractTestDetails(parsed);
          const passedTests = testDetails.filter((test) => test.passed);
          const failedTests = testDetails.filter((test) => test.failed);

          return resolve({
            success: Boolean(parsed.success),
            passed: parsed.numPassedTests || passedTests.length,
            failed: parsed.numFailedTests || failedTests.length,
            total: parsed.numTotalTests || testDetails.length,
            testDetails,
            passedTests,
            failedTests,
            rawStdout: cleanedStdout,
            rawStderr: cleanedStderr
          });
        }
      );
    } catch (error) {
      removeJestResultFile(outputFile);

      return resolve(
        buildFallbackResult({
          error,
          stdout: "",
          stderr: error.message
        })
      );
    }

    if (childProcess?.on) {
      childProcess.on("error", (error) => {
        removeJestResultFile(outputFile);

        return resolve(
          buildFallbackResult({
            error,
            stdout: "",
            stderr: error.message
          })
        );
      });
    }
  });
}

module.exports = {
  runJestTests
};
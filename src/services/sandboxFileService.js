const fs = require("fs");
const path = require("path");

const sandboxDir = path.join(process.cwd(), "sandbox");
const sourceFilePath = path.join(sandboxDir, "sample.js");
const testFilePath = path.join(sandboxDir, "sample.test.js");
const featureFilePath = path.join(sandboxDir, "module.feature");

function ensureSandboxExists() {
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }
}

function stripCodeFence(code) {
  if (typeof code !== "string") {
    return "";
  }

  return code
    .replace(/^```(?:javascript|js)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function stripFeatureFence(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/^```(?:gherkin|feature|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function writeFeatureFile(featureText) {
  try {
    ensureSandboxExists();

    const cleanText = stripFeatureFence(featureText);

    if (!cleanText.trim()) {
      throw new Error("feature file content is empty or invalid");
    }

    fs.writeFileSync(featureFilePath, cleanText, "utf8");

    return featureFilePath;
  } catch (error) {
    console.error("writeFeatureFile error:", error);

    throw new Error(`Failed to write feature file: ${error.message}`);
  }
}

function writeSourceFile(functionCode) {
  try {
    ensureSandboxExists();

    const cleanCode = stripCodeFence(functionCode);

    if (!cleanCode.trim()) {
      throw new Error("functionCode is empty or invalid");
    }

    fs.writeFileSync(sourceFilePath, cleanCode, "utf8");

    return sourceFilePath;
  } catch (error) {
    console.error("writeSourceFile error:", error);

    throw new Error(`Failed to write source file: ${error.message}`);
  }
}

function writeTestFile(testCode) {
  try {
    ensureSandboxExists();

    const cleanCode = stripCodeFence(testCode);

    if (!cleanCode.trim()) {
      throw new Error("testCode is empty or invalid");
    }

    fs.writeFileSync(testFilePath, cleanCode, "utf8");

    return testFilePath;
  } catch (error) {
    console.error("writeTestFile error:", error);

    throw new Error(`Failed to write test file: ${error.message}`);
  }
}

module.exports = {
  sandboxDir,
  sourceFilePath,
  testFilePath,
  featureFilePath,
  ensureSandboxExists,
  writeSourceFile,
  writeTestFile,
  writeFeatureFile
};
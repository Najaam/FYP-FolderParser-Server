const express = require("express");
const {
  startTesting,
  fetchTestingAnalyses,
  modifyTestingAnalysis,
  generateModuleFeatureFile,
  generateFunctionTests,
  executeModuleTests
} = require("../controllers/testingcontroller");

const router = express.Router();

router.post("/start", startTesting);
router.get("/analyses", fetchTestingAnalyses);
router.put("/analyses/:id", modifyTestingAnalysis);

// Ollama se module feature file generate karne ke liye
router.post("/feature-file", generateModuleFeatureFile);

// Ollama se test cases generate karne ke liye
router.post("/generate", generateFunctionTests);

// Generated test cases execute karne ke liye
router.post("/execute-module", executeModuleTests);

module.exports = router;
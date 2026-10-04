const express = require("express");
const {
  analyzeLocalFolder,
  analyzeApiFlow
} = require("../controllers/analyzecontroller");

const router = express.Router();

router.post("/api-flow", analyzeApiFlow);
router.post("/local-folder", analyzeLocalFolder);

module.exports = router;


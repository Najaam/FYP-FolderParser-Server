const express = require("express");
const { analyzeLocalFolder } = require("../controllers/analyzecontroller");

const router = express.Router();

router.post("/local-folder", analyzeLocalFolder);

module.exports = router;
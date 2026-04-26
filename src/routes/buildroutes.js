const express = require("express");
const { buildLocalFolder } = require("../controllers/buildcontroller");

const router = express.Router();

router.post("/local-folder", buildLocalFolder);

module.exports = router;
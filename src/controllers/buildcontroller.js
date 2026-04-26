const { buildLocalProject } = require("../services/buildservice");

async function buildLocalFolder(req, res) {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({
        success: false,
        status: "BUILD_FAILED",
        message: "folderPath is required"
      });
    }

    const result = await buildLocalProject(folderPath);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Build local folder error:", error);

    return res.status(500).json({
      success: false,
      status: "BUILD_FAILED",
      message: "Internal server error while building project",
      error: error.message
    });
  }
}

module.exports = {
  buildLocalFolder
};
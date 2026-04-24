const fs = require("fs");
const path = require("path");
const { readLocalFolder } = require("../services/localFolderservice");

async function analyzeLocalFolder(req, res) {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({
        success: false,
        message: "folderPath is required"
      });
    }

    const absoluteFolderPath = path.resolve(folderPath);

    if (!fs.existsSync(absoluteFolderPath)) {
      return res.status(404).json({
        success: false,
        message: "Folder does not exist",
        folderPath: absoluteFolderPath
      });
    }

    const stats = fs.statSync(absoluteFolderPath);

    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        message: "Provided path is not a folder",
        folderPath: absoluteFolderPath
      });
    }

    const result = readLocalFolder(absoluteFolderPath);

    return res.status(200).json({
      success: true,
      message: "Folder analyzed successfully",
      folderPath: absoluteFolderPath,
      result
    });
  } catch (error) {
    console.error("Analyze local folder error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error while analyzing folder",
      error: error.message
    });
  }
}

module.exports = { analyzeLocalFolder };
const User = require("../models/User");
const { verifyAccessToken } = require("../utils/token");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Access token is required"
      });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user no longer exists"
      });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    };

    next();
  } catch (error) {
    const message =
      error.name === "TokenExpiredError"
        ? "Access token expired"
        : "Invalid access token";

    return res.status(401).json({
      success: false,
      message
    });
  }
}

module.exports = authMiddleware;

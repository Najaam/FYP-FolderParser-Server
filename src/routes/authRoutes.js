const express = require("express");
const {
  sendOtp,
  verifyOtp,
  register,
  login,
  refresh,
  logout,
  profile,
  changePassword,
  forgotPassword,
  resetPassword,
  listSessions,
  revokeSession,
  revokeAllSessions
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// OTP
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// Public
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);

// Forgot / Reset password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected
router.get("/profile", authMiddleware, profile);
router.put("/change-password", authMiddleware, changePassword);

// Sessions
router.get("/sessions", authMiddleware, listSessions);
router.delete("/sessions", authMiddleware, revokeAllSessions);
router.delete("/sessions/:id", authMiddleware, revokeSession);

module.exports = router;

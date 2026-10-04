const bcrypt = require("bcrypt");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { generateOtpCode, sendOtpEmail } = require("../utils/emailService");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
  compareRefreshToken
} = require("../utils/token");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const refreshCookieName = "refreshToken";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Cookie durations
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day — normal session
const REMEMBER_ME_TTL_MS =
  Number(process.env.REMEMBER_ME_TTL_SECONDS) * 1000 ||
  3 * 24 * 60 * 60 * 1000; // 3 days — remember me

function getCookieOptions(rememberMe = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS
  };
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateAuthInput({ name, email, password }, mode) {
  if (mode === "register" && (!name || name.trim().length < 2)) {
    return "Name must be at least 2 characters long";
  }

  if (!email || !isValidEmail(email)) {
    return "A valid email is required";
  }

  if (!password || password.length < 6) {
    return "Password must be at least 6 characters long";
  }

  return null;
}

/**
 * Extracts lightweight session metadata from the incoming request.
 */
function getSessionMeta(req) {
  return {
    userAgent: req.headers["user-agent"] || null,
    ipAddress:
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      null
  };
}

/**
 * Generates a fresh refresh token, stores its hash in the RefreshToken
 * collection, and sets the raw value as an httpOnly cookie.
 *
 * Returns the newly created RefreshToken document.
 */
async function issueRefreshToken(res, user, req, replacesTokenId = null, rememberMe = false) {
  const rawToken = generateRefreshToken(user);
  const tokenHash = await hashRefreshToken(rawToken);
  const { userAgent, ipAddress } = getSessionMeta(req);

  // TTL for DB record matches cookie TTL
  const ttlMs = rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;

  const tokenDoc = await RefreshToken.createToken({
    userId: user._id,
    rawToken,
    tokenHash,
    userAgent,
    ipAddress,
    ttlMs
  });

  if (replacesTokenId) {
    await RefreshToken.findByIdAndUpdate(replacesTokenId, {
      $set: { replacedByTokenId: tokenDoc._id }
    });
  }

  res.cookie(refreshCookieName, rawToken, getCookieOptions(rememberMe));
  return tokenDoc;
}

// ─── OTP Handlers ────────────────────────────────────────────────────────────

/**
 * POST /auth/send-otp
 * Validates registration input, hashes password, creates/updates a
 * pending (unverified) User record, generates OTP and emails it.
 * Also handles resend — _resend flag skips re-hashing, reuses pending data.
 */
async function sendOtp(req, res) {
  try {
    const { name, email, password, _resend } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    let finalName, finalHashedPassword;

    if (_resend) {
      // Resend — find the existing pending user
      const pendingUser = await User.findOne({
        email: normalizedEmail,
        isVerified: false
      }).select("+pendingName +pendingHashedPassword +otp +otpExpiresAt +otpAttempts");

      if (!pendingUser) {
        return res.status(400).json({
          success: false,
          message: "No pending registration found. Please register again."
        });
      }

      finalName = pendingUser.pendingName;
      finalHashedPassword = pendingUser.pendingHashedPassword;
    } else {
      // New registration — validate full input
      const validationError = validateAuthInput({ name, email, password }, "register");
      if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
      }

      // Check if a verified account already exists
      const existingVerified = await User.findOne({ email: normalizedEmail, isVerified: true });
      if (existingVerified) {
        return res.status(409).json({
          success: false,
          message: "Email is already registered"
        });
      }

      finalName = name.trim();
      finalHashedPassword = await bcrypt.hash(password, 12);
    }

    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Upsert — create or update the pending user record
    await User.findOneAndUpdate(
      { email: normalizedEmail, isVerified: false },
      {
        $set: {
          name: finalName,
          password: finalHashedPassword,
          otp: code,
          otpExpiresAt: expiresAt,
          otpAttempts: 0
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendOtpEmail({ to: normalizedEmail, name: finalName, otp: code });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully. Please check your email."
    });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again."
    });
  }
}

/**
 * POST /auth/verify-otp
 * Verifies the OTP on the pending User record, activates the account.
 */
async function verifyOtp(req, res) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP code are required"
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find the pending user with OTP fields
    const user = await User.findOne({
      email: normalizedEmail,
      isVerified: false
    }).select("+otp +otpExpiresAt +otpAttempts +password");

    if (!user || !user.otp) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request a new one."
      });
    }

    // Check expiry
    if (user.otpExpiresAt < new Date()) {
      user.clearOtp();
      await user.save();
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one."
      });
    }

    // Max 5 attempts
    if (user.otpAttempts >= 5) {
      user.clearOtp();
      await user.save();
      return res.status(400).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new OTP."
      });
    }

    // Wrong code — increment attempts
    if (user.otp !== code.trim()) {
      user.otpAttempts += 1;
      await user.save();
      const remaining = 5 - user.otpAttempts;
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      });
    }

    // OTP correct — activate account, clear OTP fields
    user.isVerified = true;
    user.clearOtp();
    await user.save();

    return res.status(201).json({
      success: true,
      message: "Email verified successfully. You can now login."
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during OTP verification"
    });
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

async function register(req, res) {
  try {
    const { name, email, password } = req.body;
    const validationError = validateAuthInput({ name, email, password }, "register");

    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword
    });

    const accessToken = generateAccessToken(user);
    await issueRefreshToken(res, user, req);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      accessToken,
      user: toPublicUser(user)
    });
  } catch (error) {
    console.error("Register error:", error.message);
    console.error("Register error stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal server error during registration",
      detail: error.message
    });
  }
}

async function login(req, res) {
  try {
    const { email, password, rememberMe = false } = req.body;
    const validationError = validateAuthInput({ email, password }, "login");

    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      $or: [{ isVerified: true }, { isVerified: { $exists: false } }]
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const accessToken = generateAccessToken(user);

    // Pass rememberMe — controls cookie maxAge and DB token TTL
    await issueRefreshToken(res, user, req, null, Boolean(rememberMe));

    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken,
      user: toPublicUser(user)
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during login"
    });
  }
}

async function refresh(req, res) {
  try {
    const rawToken = req.cookies?.[refreshCookieName];

    if (!rawToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required"
      });
    }

    // 1. Verify the JWT signature and expiry
    let decoded;
    try {
      decoded = verifyRefreshToken(rawToken);
    } catch (err) {
      res.clearCookie(refreshCookieName, getCookieOptions());
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token"
      });
    }

    // 2. Find the matching token document in the DB
    //    We query all non-expired docs for this user, then bcrypt-compare
    //    to find the exact match (avoids storing the raw token in the DB).
    const candidateDocs = await RefreshToken.find({
      userId: decoded.sub,
      revoked: false,
      expiresAt: { $gt: new Date() }
    }).lean();

    let matchedDoc = null;
    for (const doc of candidateDocs) {
      const matches = await compareRefreshToken(rawToken, doc.tokenHash);
      if (matches) {
        matchedDoc = doc;
        break;
      }
    }

    if (!matchedDoc) {
      // Token not in DB — possible reuse attack: revoke all sessions for safety
      await RefreshToken.revokeAllForUser(decoded.sub);
      res.clearCookie(refreshCookieName, getCookieOptions());
      return res.status(401).json({
        success: false,
        message: "Refresh token has been revoked"
      });
    }

    // 3. Revoke the consumed token (rotation — each token is single-use)
    await RefreshToken.findByIdAndUpdate(matchedDoc._id, { $set: { revoked: true } });

    // 4. Load user and issue a new pair
    const user = await User.findById(decoded.sub);

    if (!user) {
      res.clearCookie(refreshCookieName, getCookieOptions());
      return res.status(401).json({
        success: false,
        message: "User no longer exists"
      });
    }

    const accessToken = generateAccessToken(user);
    await issueRefreshToken(res, user, req, matchedDoc._id);

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",
      accessToken,
      user: toPublicUser(user)
    });
  } catch (error) {
    console.error("Refresh error:", error);
    res.clearCookie(refreshCookieName, getCookieOptions());
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token"
    });
  }
}

async function logout(req, res) {
  try {
    const rawToken = req.cookies?.[refreshCookieName];

    if (rawToken) {
      try {
        const decoded = verifyRefreshToken(rawToken);

        // Find and revoke the specific token being used
        const candidateDocs = await RefreshToken.find({
          userId: decoded.sub,
          revoked: false,
          expiresAt: { $gt: new Date() }
        }).lean();

        for (const doc of candidateDocs) {
          const matches = await compareRefreshToken(rawToken, doc.tokenHash);
          if (matches) {
            await RefreshToken.findByIdAndUpdate(doc._id, { $set: { revoked: true } });
            break;
          }
        }
      } catch (_err) {
        // Expired/invalid token — still clear the cookie
      }
    }

    res.clearCookie(refreshCookieName, getCookieOptions());
    return res.status(200).json({ success: true, message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during logout"
    });
  }
}

/**
 * GET /auth/profile — returns the currently authenticated user.
 * req.user is populated by authMiddleware.
 */
function profile(req, res) {
  return res.status(200).json({
    success: true,
    message: "Profile fetched successfully",
    user: req.user
  });
}

/**
 * GET /auth/sessions — list all active (non-revoked, non-expired) sessions
 * for the authenticated user.
 */
async function listSessions(req, res) {
  try {
    const sessions = await RefreshToken.find({
      userId: req.user.id,
      revoked: false,
      expiresAt: { $gt: new Date() }
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      sessions: sessions.map((s) => ({
        id: s._id.toString(),
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt
      }))
    });
  } catch (error) {
    console.error("List sessions error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

/**
 * DELETE /auth/sessions/:id — revoke a specific session by its RefreshToken _id.
 * Users can only revoke their own sessions.
 */
async function revokeSession(req, res) {
  try {
    const tokenDoc = await RefreshToken.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!tokenDoc) {
      return res.status(404).json({
        success: false,
        message: "Session not found"
      });
    }

    tokenDoc.revoked = true;
    await tokenDoc.save();

    return res.status(200).json({
      success: true,
      message: "Session revoked successfully"
    });
  } catch (error) {
    console.error("Revoke session error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

/**
 * DELETE /auth/sessions — revoke ALL sessions for the authenticated user
 * (logout from every device).
 */
async function revokeAllSessions(req, res) {
  try {
    await RefreshToken.revokeAllForUser(req.user.id);
    res.clearCookie(refreshCookieName, getCookieOptions());

    return res.status(200).json({
      success: true,
      message: "All sessions revoked successfully"
    });
  } catch (error) {
    console.error("Revoke all sessions error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

/**
 * PUT /auth/change-password — change password for authenticated user.
 * Requires current password verification before updating.
 */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long"
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password"
      });
    }

    const user = await User.findById(req.user.id).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    // Revoke all sessions — user must login again with new password
    await RefreshToken.revokeAllForUser(req.user.id);
    res.clearCookie(refreshCookieName, getCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please login again."
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

/**
 * POST /auth/forgot-password
 * Sends a password reset OTP — stored on the User document.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find any existing user by email. Password resets should work for
    // verified accounts and legacy/unverified accounts that still exist.
    const user = await User.findOne({ email: normalizedEmail });

    // Always return success — don't reveal if email exists (security)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If this email is registered, a reset code has been sent."
      });
    }

    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Store OTP on the user document directly
    await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          otp: code,
          otpExpiresAt: expiresAt,
          otpAttempts: 0
        }
      },
      { new: true }
    );

    console.log("ForgotPassword — OTP saved for:", normalizedEmail, "code:", code);

    await sendOtpEmail({
      to: normalizedEmail,
      name: user.name,
      otp: code,
      subject: "Reset Your DevSure Password",
      heading: "Password Reset Code"
    });

    return res.status(200).json({
      success: true,
      message: "If this email is registered, a reset code has been sent."
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * POST /auth/reset-password
 * Verifies OTP from User document and sets a new password.
 */
async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP code, and new password are required"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters"
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail })
      .select("+otp +otpExpiresAt +otpAttempts +password");

    console.log("Reset password - user found:", user?.email, "otp:", user?.otp, "expires:", user?.otpExpiresAt);

    if (!user || !user.otp) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request a new one."
      });
    }

    // Check expiry
    if (user.otpExpiresAt < new Date()) {
      await User.findByIdAndUpdate(user._id, {
        $set: { otp: null, otpExpiresAt: null, otpAttempts: 0 }
      });
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one."
      });
    }

    // Max 5 attempts
    if (user.otpAttempts >= 5) {
      await User.findByIdAndUpdate(user._id, {
        $set: { otp: null, otpExpiresAt: null, otpAttempts: 0 }
      });
      return res.status(400).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new OTP."
      });
    }

    // Wrong code
    if (user.otp !== code.trim()) {
      await User.findByIdAndUpdate(user._id, {
        $inc: { otpAttempts: 1 }
      });
      const remaining = 5 - (user.otpAttempts + 1);
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      });
    }

    // OTP correct — update password and clear OTP
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(user._id, {
      $set: {
        password: hashedPassword,
        otp: null,
        otpExpiresAt: null,
        otpAttempts: 0
      }
    });

    // Revoke all sessions for security
    await RefreshToken.revokeAllForUser(user._id);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now sign in."
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
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
};

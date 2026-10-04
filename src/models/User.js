const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },

    // ─── OTP field ────────────────────────────────────────────
    // Single otp field on User — used for both registration
    // verification and forgot password reset.
    // Cleared immediately after successful use.
    otp: {
      type: String,
      default: null
    },
    otpExpiresAt: {
      type: Date,
      default: null
    },
    otpAttempts: {
      type: Number,
      default: 0
    },

    // True once user verifies their email via OTP
    isVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Clears OTP fields after successful use or too many attempts
userSchema.methods.clearOtp = function () {
  this.otp = null;
  this.otpExpiresAt = null;
  this.otpAttempts = 0;
};

module.exports = mongoose.model("User", userSchema);

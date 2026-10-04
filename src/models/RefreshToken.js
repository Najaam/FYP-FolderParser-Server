const mongoose = require("mongoose");

// TTL in seconds — defaults to 7 days, configurable via env
const REFRESH_TOKEN_TTL_SECONDS =
  Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 7 * 24 * 60 * 60;

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // bcrypt hash of the raw token value — never store the raw token
    tokenHash: {
      type: String,
      required: true
    },

    // When the token expires — MongoDB TTL index auto-deletes expired documents
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 } // TTL index — MongoDB deletes when Date is past
    },

    // Soft-revoked before natural expiry (logout, security event, manual revocation)
    revoked: {
      type: Boolean,
      default: false,
      index: true
    },

    // Optional session metadata — useful for "active sessions" listing
    userAgent: {
      type: String,
      default: null
    },
    ipAddress: {
      type: String,
      default: null
    },

    // Tracks token rotation — each refresh creates a new doc replacing the old
    replacedByTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null
    }
  },
  {
    timestamps: true // createdAt = session start time
  }
);

// Compound index for the hot query path: find active token by userId
refreshTokenSchema.index({ userId: 1, revoked: 1, expiresAt: 1 });

/**
 * Returns a plain object safe to send to the client as session info.
 * Never exposes tokenHash.
 */
refreshTokenSchema.methods.toSessionInfo = function () {
  return {
    id: this._id.toString(),
    userId: this.userId.toString(),
    userAgent: this.userAgent,
    ipAddress: this.ipAddress,
    createdAt: this.createdAt,
    expiresAt: this.expiresAt,
    revoked: this.revoked
  };
};

/**
 * Static helper — creates and persists a new refresh token record.
 * Returns { tokenDoc, rawToken } where rawToken is the only time the
 * plain token value is available.
 */
refreshTokenSchema.statics.createToken = async function ({
  userId,
  rawToken,
  tokenHash,
  userAgent,
  ipAddress,
  ttlMs
}) {
  // Use provided ttlMs, fallback to env/default TTL
  const resolvedTtlMs = ttlMs || REFRESH_TOKEN_TTL_SECONDS * 1000;

  const doc = await this.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + resolvedTtlMs),
    userAgent: userAgent || null,
    ipAddress: ipAddress || null
  });

  return doc;
};

/**
 * Static helper — revokes all active tokens for a user.
 * Used on logout-all-devices or password change.
 */
refreshTokenSchema.statics.revokeAllForUser = async function (userId) {
  return this.updateMany(
    { userId, revoked: false },
    { $set: { revoked: true } }
  );
};

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

function getRequiredSecret(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in environment variables`);
  }

  return value;
}

function createTokenPayload(user) {
  return {
    sub: user._id.toString(),
    email: user.email,
    role: user.role
  };
}

function generateAccessToken(user) {
  return jwt.sign(createTokenPayload(user), getRequiredSecret("JWT_ACCESS_SECRET"), {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN
  });
}

function generateRefreshToken(user) {
  return jwt.sign(createTokenPayload(user), getRequiredSecret("JWT_REFRESH_SECRET"), {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getRequiredSecret("JWT_ACCESS_SECRET"));
}

function verifyRefreshToken(token) {
  return jwt.verify(token, getRequiredSecret("JWT_REFRESH_SECRET"));
}

function hashRefreshToken(token) {
  return bcrypt.hash(token, 12);
}

function compareRefreshToken(token, tokenHash) {
  if (!token || !tokenHash) {
    return false;
  }

  return bcrypt.compare(token, tokenHash);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
  compareRefreshToken
};

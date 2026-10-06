const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const analyzeRoutes = require("./routes/analyzeroutes");
const buildRoutes = require("./routes/buildroutes");
const testingRoutes = require("./routes/testingroutes");
const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/authMiddleware");

const app = express();

const allowedOrigin = process.env.CLIENT_URL || "http://localhost:5173";

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/analyze", authMiddleware, analyzeRoutes);
app.use("/api/build", authMiddleware, buildRoutes);
app.use("/api/testing", authMiddleware, testingRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "API is runnings"
  });
});

module.exports = app;

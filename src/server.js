require("dotenv").config();
const express = require("express");
const cors = require("cors");
const analyzeRoutes = require("./routes/analyzeroutes");
const buildRoutes = require("./routes/buildroutes");
const testingRoutes = require("./routes/testingroutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/analyze", analyzeRoutes);
app.use("/api/build", buildRoutes);
app.use("/api/testing", testingRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "API is running"
  });
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


const express = require("express");
const dbconnect = require("./utils/db.connect");
const cors = require("cors");
const LoginRoute = require("./Router/LoginRoute");
const SignupRoute = require("./Router/SignupRoute");
const DataRoute = require("./Router/DataRouter");
const app = express();
const port = 4000;

// CORS options
const corsOptions = {
  origin: "http://localhost:3000",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" })); // Increase payload limit to 50MB
app.use(express.urlencoded({ limit: "50mb", extended: true }));
// app.use((req, res, next) => {
//   req.setTimeout(120000); // 120 seconds timeout
//   next();
// });

// API Routes Middleware
app.use("/auth", LoginRoute);
app.use("/user", SignupRoute);
app.use("/api", DataRoute);

dbconnect()
  .then(() => {
    app.listen(port, () => {
      console.log(`App listening on port ${port}!`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed", error);
    process.exit(1);
  });

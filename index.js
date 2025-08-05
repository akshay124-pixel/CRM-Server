require("dotenv").config();
const express = require("express");
const dbconnect = require("./utils/db.connect");
const cors = require("cors");
const LoginRoute = require("./Router/LoginRoute");
const SignupRoute = require("./Router/SignupRoute");
const DataRoute = require("./Router/DataRouter");
const tokenRoutes = require("./Router/TokenRoute");
const { Server } = require("socket.io");
const http = require("http");
const { verifyToken } = require("./utils/config jwt");

const app = express();
const port = process.env.APP_PORT;

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: `${process.env.API_URL}`,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// CORS options
const corsOptions = {
  origin: `${process.env.API_URL}`,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// API Routes Middleware
app.use("/auth", LoginRoute);
app.use("/user", SignupRoute);
app.use("/api", DataRoute);
app.use("/api", tokenRoutes);

// Socket.IO Authentication and Connection Handling

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.error("Socket Auth Error: No token provided");
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = verifyToken(token.replace("Bearer ", ""), next);
    if (!decoded || !decoded.id) {
      throw new Error("Invalid token payload");
    }
    socket.user = decoded;
    console.log(`Socket Auth Success: User ${decoded.id}`);
    next();
  } catch (error) {
    console.error(`Socket Auth Error: ${error.message}`);
    next(new Error(`Authentication error: ${error.message}`));
  }
});
io.on("connection", (socket) => {
  const userId = socket.user.id.toString(); // Ensure string format
  console.log(`User connected: ${userId} (Socket ID: ${socket.id})`);
  socket.join(userId);
  console.log(`User ${userId} joined room ${userId}`);

  socket.on("disconnect", (reason) => {
    console.log(`User disconnected: ${userId} (Reason: ${reason})`);
  });
});

// Make io instance available to controllers
app.set("io", io);

dbconnect()
  .then(() => {
    server.listen(port, () => {
      console.log(`App listening on port ${port}!`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed", error);
    process.exit(1);
  });

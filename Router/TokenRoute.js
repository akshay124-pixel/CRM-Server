const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const secretKey = require("../utils/config cypt");
const User = require("../Schema/Model");
const { verifyToken } = require("../utils/config jwt");

// GET /api/verify-token
router.get("/verify-token", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("username email role");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Verify token error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error during token verification",
    });
  }
});

// POST /api/refresh-token
router.post("/refresh-token", async (req, res) => {
  try {
    const token = req.header("Authorization")?.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Decode token to get user data, even if expired
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    // Find user
    const user = await User.findById(decoded.payload.id).select(
      "username email role"
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate new token
    const newToken = jwt.sign(
      {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      secretKey,
      { expiresIn: "12h" }
    );

    res.status(200).json({
      success: true,
      token: newToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error during token refresh",
    });
  }
});

module.exports = router;

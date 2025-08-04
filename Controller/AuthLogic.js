const User = require("../Schema/Model");
const bcrypt = require("bcrypt");
const { generateToken } = require("../utils/config jwt");

const ChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, email } = req.body;
    const userId = req.user.id; // From JWT middleware

    console.log("ChangePassword: Request received", { userId, email });

    if (!currentPassword || !newPassword || !email) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    // Check if new password is same as current
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    // Password complexity validation
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 8 characters long and include uppercase, lowercase, number, and special character",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log("ChangePassword: User not found", { userId });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Verify email matches the authenticated user
    if (user.email !== email) {
      console.log("ChangePassword: Email mismatch", { 
        providedEmail: email, 
        userEmail: user.email 
      });
      return res.status(403).json({
        success: false,
        message: "Email does not match authenticated user",
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      console.log("ChangePassword: Current password incorrect for user", { userId });
      return res
        .status(401)
        .json({ success: false, message: "Current password is incorrect" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    user.lastPasswordChange = new Date(); // Track password change timestamp
    await user.save();

    console.log("ChangePassword: Password changed successfully for user", { userId });

    // Emit Socket.IO event for audit logging
    const io = req.app.get("io");
    if (io) {
      io.to(userId.toString()).emit("passwordChange", {
        userId,
        email,
        timestamp: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while changing password",
    });
  }
};

// Existing Signup and Login functions remain unchanged
const Signup = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    if (!["superadmin", "admin", "others"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const existingEmailUser = await User.findOne({ email });
    if (existingEmailUser) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      role,
      assignedAdmin: role === "others" ? null : undefined,
    });

    await newUser.save();

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        id: newUser._id.toString(),
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        assignedAdmin: newUser.assignedAdmin,
      },
      token,
    });
  } catch (error) {
    console.error("Signup Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "An error occurred during signup." });
  }
};

const Login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        assignedAdmin: user.assignedAdmin,
      },
      token,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "An error occurred during login." });
  }
};

module.exports = { Signup, Login, ChangePassword };

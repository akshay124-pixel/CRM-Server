const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    match: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      "Please fill a valid email address",
    ],
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["superadmin", "admin", "others"],
    default: "others",
    required: true,
  },
  assignedAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null, // Null for untagged users or non-"others" roles
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;

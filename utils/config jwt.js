const jwt = require("jsonwebtoken");
const secretKey = require("./config cypt");

function generateToken(user) {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, secretKey, { expiresIn: "30d" });
}

const verifyToken = (tokenOrReq, resOrNext, next) => {
  let token;
  let res;
  let callback;

  // Check if called as HTTP middleware or Socket.IO token verifier
  if (typeof tokenOrReq === "string") {
    // Socket.IO case
    token = tokenOrReq;
    callback = resOrNext; // This is the next function for Socket.IO
  } else {
    // HTTP middleware case
    token = tokenOrReq.header("Authorization")?.split(" ")[1];
    res = resOrNext;
    callback = next;
  }

  if (!token) {
    if (res) {
      return res
        .status(403)
        .json({ success: false, message: "No token provided, access denied." });
    } else {
      throw new Error("No token provided, access denied.");
    }
  }

  try {
    const decoded = jwt.verify(token, secretKey);
    if (res) {
      tokenOrReq.user = decoded; // For HTTP, attach to req
    }
    callback(null, decoded); // For Socket.IO, pass decoded to next
    return decoded; // Return for immediate use if needed
  } catch (error) {
    if (res) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token." });
    } else {
      throw new Error("Invalid or expired token.");
    }
  }
};

module.exports = { generateToken, verifyToken };

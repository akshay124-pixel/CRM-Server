const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  checkIn: {
    type: Date,
  },
  checkOut: {
    type: Date,
  },
  status: {
    type: String,
    enum: ["Present", "Absent", "Late"],
    default: "Absent",
  },
  remarks: {
    type: String,
  },
  checkInLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  checkOutLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  liveLocation: {
    type: String, // Optional: Store a human-readable address or location name
  },
});

module.exports = mongoose.model("Attendance", attendanceSchema);

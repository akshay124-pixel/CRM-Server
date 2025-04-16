const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  specification: { type: String, required: true },
  size: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
});

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  remarks: { type: String, required: true },
  liveLocation: { type: String },
  products: [productSchema],
  timestamp: { type: Date, default: Date.now },
  firstPersonMeet: { type: String },
  secondPersonMeet: { type: String },
  thirdPersonMeet: { type: String },
  fourthPersonMeet: { type: String },
});

const entrySchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  mobileNumber: {
    type: String,
    required: true,
    match: [/^\d{10}$/, "Mobile number must be 10 digits"],
  },
  contactperson: { type: String, required: true },
  firstdate: { type: Date },
  estimatedValue: { type: Number, min: 0 },
  address: { type: String, required: true },
  state: { type: String, required: true },
  city: { type: String, required: true },
  organization: { type: String, required: true },
  type: { type: String, enum: ["Partner", "Direct Client"], required: true },
  category: { type: String, enum: ["Private", "Government"], required: true },
  products: [productSchema],
  status: { type: String, default: "Not Found" },
  expectedClosingDate: { type: Date },
  followUpDate: { type: Date },
  remarks: { type: String },
  liveLocation: { type: String },
  nextAction: { type: String },
  closetype: { type: String, enum: ["Closed Won", "Closed Lost", ""] },
  firstPersonMeet: { type: String },
  secondPersonMeet: { type: String },
  thirdPersonMeet: { type: String },
  fourthPersonMeet: { type: String },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  history: [historySchema],
});

const Entry = mongoose.model("Entry", entrySchema);

module.exports = Entry;

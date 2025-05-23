const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String },
  specification: { type: String },
  size: { type: String },
  quantity: { type: Number, min: 1 },
});

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  remarks: { type: String },
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
    match: [/^\d{10}$/, "Mobile number must be 10 digits"],
  },
  contactperson: { type: String },
  firstdate: { type: Date },
  estimatedValue: { type: Number, min: 0 },
  address: { type: String },
  state: { type: String },
  city: { type: String },
  organization: { type: String },
  type: { type: String },
  category: { type: String },
  products: [productSchema],
  status: { type: String, default: "Not Found" },
  expectedClosingDate: { type: Date },
  closeamount: { type: Number, min: 0 },
  followUpDate: { type: Date },
  remarks: { type: String },
  liveLocation: { type: String, required: true },
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

module.exports = mongoose.model("Entry", entrySchema);

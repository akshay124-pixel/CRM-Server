const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  specification: { type: String, required: true, trim: true },
  size: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
});

const historySchema = new mongoose.Schema({
  status: { type: String, required: true, trim: true },
  remarks: { type: String, trim: true },
  liveLocation: { type: String, trim: true },
  products: [productSchema],
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  timestamp: { type: Date, default: Date.now },
  firstPersonMeet: { type: String, trim: true },
  secondPersonMeet: { type: String, trim: true },
  thirdPersonMeet: { type: String, trim: true },
  fourthPersonMeet: { type: String, trim: true },
});

const entrySchema = new mongoose.Schema(
  {
    customerName: { type: String, trim: true },
    mobileNumber: {
      type: String,
      match: [/^\d{10}$/, "Mobile number must be 10 digits"],
      trim: true,
    },
    contactperson: { type: String, trim: true },
    firstdate: { type: Date },
    estimatedValue: { type: Number, min: 0 },
    address: { type: String, trim: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    organization: { type: String, trim: true },
    type: { type: String, trim: true },
    category: { type: String, trim: true },
    products: [productSchema],
    status: {
      type: String,
      required: true,
      default: "Not Found",
      enum: ["Not Found", "Maybe", "Interested", "Not Interested", "Closed"],
    },
    expectedClosingDate: { type: Date },
    closeamount: { type: Number, min: 0 },
    followUpDate: { type: Date },
    remarks: { type: String, trim: true },
    liveLocation: { type: String, trim: true },
    nextAction: { type: String, trim: true },
    closetype: {
      type: String,
      enum: ["Closed Won", "Closed Lost", ""],
      default: "",
    },
    firstPersonMeet: { type: String, trim: true },
    secondPersonMeet: { type: String, trim: true },
    thirdPersonMeet: { type: String, trim: true },
    fourthPersonMeet: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // Updated to array
    history: [historySchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { strict: false }
);

module.exports = mongoose.model("Entry", entrySchema);

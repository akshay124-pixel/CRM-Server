const mongoose = require("mongoose");
URI =
  "mongodb+srv://mrakshaythakur124:Akshay0001@cluster0.mls7h5e.mongodb.net/Data_Mangement";

const dbconnect = async () => {
  try {
    await mongoose.connect(URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.log("Error connecting to MongoDB");
  }
};
module.exports = dbconnect;

const mongoose = require("mongoose");
URI =
   "mongodb+srv://promarkdatabase:promarkdatabase%401234@promarkdb.zfwjisc.mongodb.net/CRM_Data";

const dbconnect = async () => {
  try {
    await mongoose.connect(URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.log("Error connecting to MongoDB");
  }
};
module.exports = dbconnect;

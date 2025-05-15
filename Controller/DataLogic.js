// DataRoute.js
const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const XLSX = require("xlsx");
const Attendance = require("../Schema/AttendanceSchema");
const DataentryLogic = async (req, res) => {
  try {
    const {
      customerName,
      mobileNumber,
      contactperson,
      firstdate,
      estimatedValue,
      address,
      state,
      city,
      organization,
      type,
      category,
      products,
      status,
      expectedClosingDate,
      followUpDate,
      remarks,
      liveLocation,
    } = req.body;

    const numericEstimatedValue = estimatedValue ? Number(estimatedValue) : 0;

    // Validate products only if provided
    if (products && Array.isArray(products) && products.length > 0) {
      for (const product of products) {
        if (
          !product.name ||
          !product.specification ||
          !product.size ||
          !product.quantity ||
          product.quantity < 1
        ) {
          return res.status(400).json({
            success: false,
            message:
              "All product fields (name, specification, size, quantity) are required and quantity must be positive",
          });
        }
      }
    }

    const historyEntry = status
      ? {
          status: status || "Not Found",
          remarks: remarks || "Initial entry created",
          liveLocation: liveLocation || undefined,
          products: products || [], // Use empty array if products not provided
          timestamp: new Date(),
        }
      : undefined;

    const newEntry = new Entry({
      customerName: customerName?.trim(),
      mobileNumber: mobileNumber?.trim(),
      contactperson: contactperson?.trim(),
      firstdate: firstdate ? new Date(firstdate) : undefined,
      estimatedValue:
        numericEstimatedValue > 0 ? numericEstimatedValue : undefined,
      address: address?.trim(),
      state: state?.trim(),
      city: city?.trim(),
      organization: organization?.trim(),
      type: type?.trim(),
      category: category?.trim(),
      products: products || [], // Use empty array if products not provided
      status: status || "Not Found",
      expectedClosingDate: expectedClosingDate
        ? new Date(expectedClosingDate)
        : undefined,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
      remarks: remarks?.trim(),
      liveLocation: liveLocation?.trim(),
      createdBy: req.user.id,
      history: historyEntry ? [historyEntry] : [],
    });

    await newEntry.save();

    const populatedEntry = await Entry.findById(newEntry._id).populate(
      "createdBy",
      "username"
    );

    res.status(201).json({
      success: true,
      data: populatedEntry,
      message: "Entry created successfully.",
    });
  } catch (error) {
    console.error("Error in DataentryLogic:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
const fetchEntries = async (req, res) => {
  try {
    let entries;
    if (req.user.role === "superadmin") {
      entries = await Entry.find()
        .populate("createdBy", "username role assignedAdmin")
        .lean();
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      entries = await Entry.find({
        $or: [
          { createdBy: req.user.id },
          { createdBy: { $in: teamMemberIds } },
        ],
      })
        .populate("createdBy", "username role assignedAdmin")
        .lean();
    } else {
      entries = await Entry.find({ createdBy: req.user.id })
        .populate("createdBy", "username role assignedAdmin")
        .lean();
    }
    res.status(200).json(entries);
  } catch (error) {
    console.error("Error fetching entries:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch entries",
      error: error.message,
    });
  }
};

const DeleteData = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid entry ID" });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    if (req.user.role === "superadmin") {
      // Superadmin can delete any entry
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      if (
        entry.createdBy.toString() !== req.user.id &&
        !teamMemberIds.includes(entry.createdBy)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }
    } else {
      if (entry.createdBy.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }
    }

    await Entry.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Entry deleted successfully" });
  } catch (error) {
    console.error("Error deleting entry:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete entry",
      error: error.message,
    });
  }
};

const editEntry = async (req, res) => {
  try {
    const {
      customerName,
      mobileNumber,
      contactperson,
      firstdate,
      address,
      state,
      city,
      products,
      type,
      organization,
      category,
      status,
      expectedClosingDate,
      followUpDate,
      remarks,
      liveLocation,
      nextAction,
      estimatedValue,
      closeamount,
      closetype,
      firstPersonMeet,
      secondPersonMeet,
      thirdPersonMeet,
      fourthPersonMeet,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid entry ID" });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    // Optional Product Validation (no error thrown)
    if (Array.isArray(products)) {
      for (const product of products) {
        if (
          !product.name ||
          !product.specification ||
          !product.size ||
          !product.quantity ||
          product.quantity < 1
        ) {
          console.warn("Skipping invalid product:", product);
          continue;
        }
      }
    }

    let historyEntry = {};

    if (status !== undefined && status !== entry.status) {
      historyEntry = {
        status,
        ...(remarks && { remarks }),
        ...(liveLocation && { liveLocation }),
        ...(nextAction && { nextAction }),
        ...(estimatedValue && { estimatedValue }),
        products: products || entry.products,
        timestamp: new Date(),
      };
    } else if (remarks !== undefined && remarks !== entry.remarks) {
      historyEntry = {
        status: entry.status,
        remarks,
        ...(liveLocation && { liveLocation }),
        products: products || entry.products,
        timestamp: new Date(),
      };
    } else if (
      products !== undefined &&
      JSON.stringify(products) !== JSON.stringify(entry.products)
    ) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Products updated",
        ...(liveLocation && { liveLocation }),
        products,
        timestamp: new Date(),
      };
    }

    const personMeetFields = {
      firstPersonMeet,
      secondPersonMeet,
      thirdPersonMeet,
      fourthPersonMeet,
    };

    for (const [field, value] of Object.entries(personMeetFields)) {
      if (
        value !== undefined &&
        value.trim() !== "" &&
        value !== entry[field]
      ) {
        historyEntry[field] = value.trim();
      }
    }

    if (Object.keys(historyEntry).length > 0) {
      if (entry.history.length >= 4) {
        entry.history.shift();
      }
      entry.history.push(historyEntry);
    }

    // Update entry fields only if provided
    Object.assign(entry, {
      ...(customerName !== undefined && { customerName: customerName.trim() }),
      ...(mobileNumber !== undefined && { mobileNumber: mobileNumber.trim() }),
      ...(contactperson !== undefined && {
        contactperson: contactperson.trim(),
      }),
      ...(firstdate !== undefined && {
        firstdate: firstdate ? new Date(firstdate) : null,
      }),
      ...(address !== undefined && { address: address.trim() }),
      ...(state !== undefined && { state: state.trim() }),
      ...(city !== undefined && { city: city.trim() }),
      ...(products !== undefined && { products }),
      ...(type !== undefined && { type: type.trim() }),
      ...(organization !== undefined && { organization: organization.trim() }),
      ...(category !== undefined && { category: category.trim() }),
      ...(status !== undefined && { status }),
      ...(expectedClosingDate !== undefined && {
        expectedClosingDate: expectedClosingDate
          ? new Date(expectedClosingDate)
          : null,
      }),
      ...(followUpDate !== undefined && {
        followUpDate: followUpDate ? new Date(followUpDate) : null,
      }),
      ...(closetype !== undefined && { closetype: closetype.trim() }),
      ...(remarks !== undefined && { remarks }),
      ...(nextAction !== undefined && { nextAction: nextAction.trim() }),
      ...(estimatedValue !== undefined && {
        estimatedValue: Number(estimatedValue),
      }),
      ...(closeamount !== undefined && {
        closeamount: Number(closeamount),
      }),
      ...(firstPersonMeet !== undefined && {
        firstPersonMeet: firstPersonMeet.trim(),
      }),
      ...(secondPersonMeet !== undefined && {
        secondPersonMeet: secondPersonMeet.trim(),
      }),
      ...(thirdPersonMeet !== undefined && {
        thirdPersonMeet: thirdPersonMeet.trim(),
      }),
      ...(fourthPersonMeet !== undefined && {
        fourthPersonMeet: fourthPersonMeet.trim(),
      }),
    });

    const updatedEntry = await entry.save();

    res.status(200).json({
      success: true,
      data: updatedEntry,
      message: "Entry updated successfully",
    });
  } catch (error) {
    console.error("Error in editEntry:", error.message);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error updating entry",
      error: error.message,
    });
  }
};

const bulkUploadStocks = async (req, res) => {
  try {
    const newEntries = req.body;

    if (!Array.isArray(newEntries) || newEntries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data format. Array expected.",
      });
    }

    const formattedEntries = newEntries.map((entry) => ({
      customerName: entry.customerName?.trim() || "",
      mobileNumber: entry.mobileNumber?.trim() || "",
      contactperson: entry.contactperson?.trim() || "",
      address: entry.address?.trim() || "",
      state: entry.state?.trim() || "",
      city: entry.city?.trim() || "",
      organization: entry.organization?.trim() || "",
      category: entry.category?.trim() || "",
      type: entry.type?.trim() || "Customer",
      products: Array.isArray(entry.products)
        ? entry.products.map((product) => ({
            name: product.name?.trim() || "",
            specification: product.specification?.trim() || "",
            size: product.size?.trim() || "",
            quantity: Number(product.quantity) || 0,
          }))
        : [],
      remarks: entry.remarks?.trim() || "",
      status: entry.status?.trim() || "Not Found",
      createdBy: req.user.id,
      createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
      firstdate: entry.firstdate ? new Date(entry.firstdate) : undefined,
      expectedClosingDate: entry.expectedClosingDate
        ? new Date(entry.expectedClosingDate)
        : undefined,
      followUpDate: entry.followUpDate
        ? new Date(entry.followUpDate)
        : undefined,
      estimatedValue: entry.estimatedValue
        ? Number(entry.estimatedValue)
        : undefined,
      closeamount: entry.closeamount ? Number(entry.closeamount) : undefined,
      closetype: entry.closetype?.trim() || "",
      nextAction: entry.nextAction?.trim() || "",
      liveLocation: entry.liveLocation?.trim() || "",
      firstPersonMeet: entry.firstPersonMeet?.trim() || "",
      secondPersonMeet: entry.secondPersonMeet?.trim() || "",
      thirdPersonMeet: entry.thirdPersonMeet?.trim() || "",
      fourthPersonMeet: entry.fourthPersonMeet?.trim() || "",
    }));

    const batchSize = 500;
    for (let i = 0; i < formattedEntries.length; i += batchSize) {
      const batch = formattedEntries.slice(i, i + batchSize);
      await Entry.insertMany(batch, { ordered: false });
    }

    res.status(201).json({
      success: true,
      message: "Entries uploaded successfully!",
      count: formattedEntries.length,
    });
  } catch (error) {
    console.error("Error in bulk upload:", error.message);
    res.status(400).json({
      success: false,
      message: "Failed to upload entries",
      error: error.message,
    });
  }
};
const exportentry = async (req, res) => {
  try {
    let query = {};
    const filters = req.query;

    // Role-based data access
    if (req.user.role === "superadmin") {
      // Superadmin can access all entries
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      query = {
        $or: [
          { createdBy: req.user.id },
          { createdBy: { $in: teamMemberIds } },
        ],
      };
    } else {
      query = { createdBy: req.user.id };
    }

    // Apply filters from query parameters
    if (filters.customerName) {
      query.customerName = { $regex: filters.customerName, $options: "i" };
    }
    if (filters.mobileNumber) {
      query.mobileNumber = filters.mobileNumber;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.category) {
      query.category = filters.category;
    }
    if (filters.state) {
      query.state = filters.state;
    }
    if (filters.city) {
      query.city = filters.city;
    }
    if (filters.type) {
      query.type = filters.type;
    }
    if (filters.fromDate && filters.toDate) {
      query.createdAt = {
        $gte: new Date(filters.fromDate),
        $lte: new Date(filters.toDate),
      };
    }

    const entries = await Entry.find(query)
      .populate("createdBy", "username role assignedAdmin")
      .lean();

    const formattedEntries = entries.map((entry) => ({
      Customer_Name: entry.customerName || "N/A",
      Mobile_Number: entry.mobileNumber || "N/A",
      Contact_Person: entry.contactperson || "N/A",
      First_Date: entry.firstdate
        ? entry.firstdate.toLocaleDateString()
        : "Not Set",
      Address: entry.address || "N/A",
      State: entry.state || "N/A",
      City: entry.city || "N/A",
      Products:
        entry.products
          .map(
            (p) =>
              `${p.name} (${p.specification}, ${p.size}, Qty: ${p.quantity})`
          )
          .join("; ") || "N/A",
      Type: entry.type || "Customer",
      Organization: entry.organization || "N/A",
      Category: entry.category || "N/A",
      Status: entry.status || "Not Found",
      Created_At: entry.createdAt.toLocaleDateString(),
      Created_By: entry.createdBy?.username || "Unknown",
      Close_Type: entry.closetype || "Not Set",
      Expected_Closing_Date: entry.expectedClosingDate
        ? entry.expectedClosingDate.toLocaleDateString()
        : "Not Set",
      Follow_Up_Date: entry.followUpDate
        ? entry.followUpDate.toLocaleDateString()
        : "Not Set",
      Remarks: entry.remarks || "Not Set",
      Estimated_Value: entry.estimatedValue || 0,
      Close_Amount: entry.closeamount || 0,
      Next_Action: entry.nextAction || "Not Set",
      Live_Location: entry.liveLocation || "Not Set",
      First_Person_Met: entry.firstPersonMeet || "Not Set",
      Second_Person_Met: entry.secondPersonMeet || "Not Set",
      Third_Person_Met: entry.thirdPersonMeet || "Not Set",
      Fourth_Person_Met: entry.fourthPersonMeet || "Not Set",
    }));

    // Create Excel worksheet with formatting
    const ws = XLSX.utils.json_to_sheet(formattedEntries);
    ws["!cols"] = [
      { wch: 20 }, // Customer_Name
      { wch: 15 }, // Mobile_Number
      { wch: 20 }, // Contact_Person
      { wch: 15 }, // First_Date
      { wch: 30 }, // Address
      { wch: 15 }, // State
      { wch: 15 }, // City
      { wch: 50 }, // Products
      { wch: 15 }, // Type
      { wch: 20 }, // Organization
      { wch: 15 }, // Category
      { wch: 15 }, // Status
      { wch: 15 }, // Created_At
      { wch: 15 }, // Created_By
      { wch: 15 }, // Close_Type
      { wch: 20 }, // Expected_Closing_Date
      { wch: 20 }, // Follow_Up_Date
      { wch: 30 }, // Remarks
      { wch: 15 }, // Estimated_Value
      { wch: 15 }, // Close_Amount
      { wch: 20 }, // Next_Action
      { wch: 20 }, // Live_Location
      { wch: 20 }, // First_Person_Met
      { wch: 20 }, // Second_Person_Met
      { wch: 20 }, // Third_Person_Met
      { wch: 20 }, // Fourth_Person_Met
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Entries");

    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Disposition", "attachment; filename=entries.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error exporting entries:", error.message);
    res.status(500).json({
      success: false,
      message: "Error exporting entries",
      error: error.message,
    });
  }
};
const getAdmin = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: No user found" });
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      isAdmin: user.role === "admin" || user.role === "superadmin",
      role: user.role,
      userId: user._id.toString(),
    });
  } catch (error) {
    console.error("Error fetching user:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const fetchUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const users = await User.find({ role: "others" })
      .select("username email assignedAdmin")
      .lean();

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

const assignUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== "others") {
      return res.status(404).json({
        success: false,
        message: "User not found or not an 'others' role",
      });
    }

    user.assignedAdmin = req.user.id;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User assigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmin: user.assignedAdmin,
      },
    });
  } catch (error) {
    console.error("Error assigning user:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to assign user",
      error: error.message,
    });
  }
};

const unassignUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== "others") {
      return res.status(404).json({
        success: false,
        message: "User not found or not an 'others' role",
      });
    }

    if (
      req.user.role === "admin" &&
      user.assignedAdmin?.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to unassign this user",
      });
    }

    user.assignedAdmin = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User unassigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmin: user.assignedAdmin,
      },
    });
  } catch (error) {
    console.error("Error unassigning user:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to unassign user",
      error: error.message,
    });
  }
};

const checkIn = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: today,
    });

    if (existingAttendance && existingAttendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: "Already checked in today",
      });
    }

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      checkIn: new Date(),
      status: "Present",
    });

    await attendance.save();

    res.status(201).json({
      success: true,
      message: "Checked in successfully",
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to check in",
      error: error.message,
    });
  }
};

const checkOut = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date: today,
    });

    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: "No check-in record found for today",
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: "Already checked out today",
      });
    }

    attendance.checkOut = new Date();
    attendance.status = "Present";
    await attendance.save();

    res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to check out",
      error: error.message,
    });
  }
};

const fetchAttendance = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};

    if (req.user.role === "superadmin") {
      // Superadmin can access all
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      query.user = { $in: [req.user.id, ...teamMemberIds] };
    } else {
      query.user = req.user.id;
    }

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const attendance = await Attendance.find(query)
      .populate("user", "username")
      .sort({ date: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch attendance",
      error: error.message,
    });
  }
};

module.exports = {
  bulkUploadStocks,
  DataentryLogic,
  fetchEntries,
  DeleteData,
  editEntry,
  exportentry,
  getAdmin,
  fetchUsers,
  assignUser,
  unassignUser,
  checkIn,
  checkOut,
  fetchAttendance,
};

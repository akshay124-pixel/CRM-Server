// DataRoute.js
const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const XLSX = require("xlsx");

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

    const validatedEntries = newEntries.map((entry) => {
      const requiredFields = [
        "customerName",
        "mobileNumber",
        "contactperson",
        "address",
        "products",
        "organization",
        "category",
        "state",
        "city",
      ];

      for (const field of requiredFields) {
        if (
          !entry[field] ||
          (typeof entry[field] !== "string" && field !== "products") ||
          (typeof entry[field] === "string" && entry[field].trim() === "")
        ) {
          throw new Error(
            `${field} is required and must be a non-empty string`
          );
        }
      }

      if (!/^\d{10}$/.test(entry.mobileNumber)) {
        throw new Error("Mobile number must be exactly 10 digits");
      }

      if (!["Partner", "Customer"].includes(entry.type)) {
        throw new Error("Type must be either 'Partner' or 'Customer'");
      }

      if (!["Private", "Government"].includes(entry.category)) {
        throw new Error("Category must be either 'Private' or 'Government'");
      }

      if (
        entry.estimatedValue &&
        (isNaN(entry.estimatedValue) || entry.estimatedValue < 0)
      ) {
        throw new Error("Estimated value must be a non-negative number");
      }

      if (!Array.isArray(entry.products) || entry.products.length === 0) {
        throw new Error("Products must be a non-empty array");
      }

      const trimmedProducts = entry.products.map((product) => ({
        name: product.name?.trim() || "",
        specification: product.specification?.trim() || "",
        size: product.size?.trim() || "",
        quantity: Number(product.quantity) || 0,
      }));

      for (const product of trimmedProducts) {
        if (
          !product.name ||
          !product.specification ||
          !product.size ||
          !product.quantity ||
          product.quantity < 1
        ) {
          throw new Error(
            "All product fields (name, specification, size, quantity) are required and quantity must be positive"
          );
        }
      }

      return {
        customerName: entry.customerName.trim(),
        mobileNumber: entry.mobileNumber.trim(),
        contactperson: entry.contactperson.trim(),
        firstdate: entry.firstdate ? new Date(entry.firstdate) : undefined,
        address: entry.address.trim(),
        state: entry.state.trim(),
        city: entry.city.trim(),
        products: trimmedProducts,
        type: entry.type.trim(),
        organization: entry.organization.trim(),
        category: entry.category.trim(),
        remarks: entry.remarks?.trim() || "",
        createdBy: req.user.id,
        createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
        status: entry.status?.trim() || "Not Found",
        expectedClosingDate: entry.expectedClosingDate
          ? new Date(entry.expectedClosingDate)
          : undefined,
        closetype: entry.closetype?.trim() || "",
        followUpDate: entry.followUpDate
          ? new Date(entry.followUpDate)
          : undefined,
        estimatedValue: entry.estimatedValue
          ? Number(entry.estimatedValue)
          : undefined,
        closeamount: entry.closeamount ? Number(entry.closeamount) : undefined,
        nextAction: entry.nextAction?.trim() || "",
      };
    });

    const batchSize = 500;
    for (let i = 0; i < validatedEntries.length; i += batchSize) {
      const batch = validatedEntries.slice(i, i + batchSize);
      await Entry.insertMany(batch, { ordered: false });
    }

    res.status(201).json({
      success: true,
      message: "Entries uploaded successfully!",
      count: validatedEntries.length,
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

    const formattedEntries = entries.map((entry) => ({
      customerName: entry.customerName,
      mobileNumber: entry.mobileNumber,
      contactperson: entry.contactperson,
      firstdate: entry.firstdate?.toLocaleDateString() || "Not Set",
      address: entry.address,
      state: entry.state,
      city: entry.city,
      products: entry.products
        .map(
          (p) => `${p.name} (${p.specification}, ${p.size}, Qty: ${p.quantity})`
        )
        .join("; "),
      type: entry.type,
      organization: entry.organization,
      category: entry.category,
      status: entry.status || "Not Found",
      createdAt: entry.createdAt.toLocaleDateString(),
      createdBy: entry.createdBy.username,
      closetype: entry.closetype || "Not Set",
      expectedClosingDate: entry.expectedClosingDate
        ? entry.expectedClosingDate.toLocaleDateString()
        : "Not Set",
      followUpDate: entry.followUpDate
        ? entry.followUpDate.toLocaleDateString()
        : "Not Set",
      remarks: entry.remarks || "Not Set",
      estimatedValue: entry.estimatedValue || 0,
      closeamount: entry.closeamount || 0,
      nextAction: entry.nextAction || "Not Set",
    }));

    const ws = XLSX.utils.json_to_sheet(formattedEntries);
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
};

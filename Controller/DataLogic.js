const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const Notification = require("../Schema/NotificationSchema");
const XLSX = require("xlsx");
const Attendance = require("../Schema/AttendanceSchema");
const schedule = require("node-schedule");
// Helper function to create a notification
// Replace the existing createNotification function with this
const createNotification = async (userId, message, entryId = null, io) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error(`Invalid userId: ${userId}`);
      return;
    }

    if (!io) {
      console.error("Socket.IO instance not provided for notification");
      return;
    }

    let validatedEntryId = null;
    if (entryId && mongoose.Types.ObjectId.isValid(entryId)) {
      validatedEntryId = new mongoose.Types.ObjectId(entryId);
    } else if (entryId) {
      console.warn(`Invalid entryId: ${entryId}`);
    }

    const notification = new Notification({
      userId: new mongoose.Types.ObjectId(userId),
      message,
      entryId: validatedEntryId,
      read: false,
      timestamp: new Date(),
    });

    await notification.save();
    console.log(`Notification saved for user ${userId}: ${message}`);

    const notificationData = {
      ...notification.toObject(),
      entryId: validatedEntryId ? { _id: validatedEntryId } : null,
    };

    io.to(userId.toString()).emit("newNotification", notificationData);
    console.log(`Notification emitted to user ${userId}: ${message}`);
  } catch (error) {
    console.error(
      `Error creating notification for user ${userId}: ${error.message}`
    );
  }
};

// Run date notification check at midnight
schedule.scheduleJob("0 0 * * *", () => {
  const io = app.get("io");
  if (io) {
    checkDateNotifications(io);
    console.log("Scheduled date notifications check executed");
  } else {
    console.error("Socket.IO instance not found for scheduled notifications");
  }
});

// Update existing functions to use io
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
      assignedTo,
    } = req.body;

    const numericEstimatedValue = estimatedValue ? Number(estimatedValue) : 0;
    const io = req.app.get("io");

    // Validate products
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

    // Validate assignedTo if provided
    let validatedAssignedTo = [];
    if (assignedTo && Array.isArray(assignedTo) && assignedTo.length > 0) {
      for (const userId of assignedTo) {
        if (mongoose.Types.ObjectId.isValid(userId)) {
          const user = await User.findById(userId);
          if (!user) {
            return res.status(400).json({
              success: false,
              message: `Invalid user ID in assignedTo: ${userId}`,
            });
          }
          validatedAssignedTo.push(userId);
        } else {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format in assignedTo: ${userId}`,
          });
        }
      }
    }

    const timestamp = new Date();
    const historyEntry = {
      status: status || "Not Found",
      remarks: remarks || "Initial entry created",
      liveLocation: liveLocation || undefined,
      products: products || [],
      assignedTo: validatedAssignedTo,
      timestamp,
    };

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
      products: products || [],
      status: status || "Not Found",
      expectedClosingDate: expectedClosingDate
        ? new Date(expectedClosingDate)
        : undefined,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
      remarks: remarks?.trim(),
      liveLocation: liveLocation?.trim(),
      createdBy: req.user.id,
      assignedTo: validatedAssignedTo,
      history: [historyEntry],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await newEntry.save();

    // Create notification for entry creation
    await createNotification(
      req.user.id,
      `New entry created: ${customerName}`,
      newEntry._id,
      io
    );

    // Create notifications for assigned users
    if (validatedAssignedTo.length > 0) {
      for (const userId of validatedAssignedTo) {
        await createNotification(
          userId,
          `You have been assigned to a new entry: ${customerName}`,
          newEntry._id,
          io
        );
      }
    }

    const populatedEntry = await Entry.findById(newEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username");

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
        .populate("assignedTo", "username role assignedAdmin")
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
          { assignedTo: req.user.id },
          { assignedTo: { $in: teamMemberIds } },
        ],
      })
        .populate("createdBy", "username role assignedAdmin")
        .populate("assignedTo", "username role assignedAdmin")
        .lean();
    } else {
      entries = await Entry.find({
        $or: [{ createdBy: req.user.id }, { assignedTo: req.user.id }],
      })
        .populate("createdBy", "username role assignedAdmin")
        .populate("assignedTo", "username role assignedAdmin")
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
}; // Helper function to check and generate date-based notifications
const checkDateNotifications = async (io) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

    const entries = await Entry.find({
      $or: [
        { followUpDate: { $gte: tomorrow, $lt: dayAfterTomorrow } },
        { expectedClosingDate: { $gte: tomorrow, $lt: dayAfterTomorrow } },
      ],
    }).populate("assignedTo createdBy", "username");

    for (const entry of entries) {
      const messagePrefix = entry.followUpDate
        ? `Follow-up due tomorrow for ${entry.customerName}`
        : `Expected closing date tomorrow for ${entry.customerName}`;
      const message = `${messagePrefix} (Entry ID: ${entry._id})`;

      // Notify creator
      if (entry.createdBy) {
        await createNotification(entry.createdBy._id, message, entry._id, io);
      }

      // Notify assigned users
      if (entry.assignedTo && Array.isArray(entry.assignedTo)) {
        for (const user of entry.assignedTo) {
          await createNotification(user._id, message, entry._id, io);
        }
      }
    }
  } catch (error) {
    console.error("Error in date-based notifications:", error.message);
  }
};

// Run date notification check periodically
setInterval(() => checkDateNotifications(app.get("io")), 24 * 60 * 60 * 1000);

// New endpoint to clear all notifications
const clearNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    await Notification.deleteMany({ userId: req.user.id });

    const io = req.app.get("io");
    io.to(req.user.id).emit("notificationsCleared");

    res.status(200).json({
      success: true,
      message: "All notifications cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing notifications:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
      error: error.message,
    });
  }
};
// Update existing endpoints to include io
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

    const io = req.app.get("io");

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

    // Create notification for deletion
    await createNotification(
      req.user.id,
      `Entry deleted: ${entry.customerName}`,
      entry._id,
      io
    );

    // Notify assigned users
    if (entry.assignedTo && Array.isArray(entry.assignedTo)) {
      for (const userId of entry.assignedTo) {
        await createNotification(
          userId,
          `Entry you were assigned to was deleted: ${entry.customerName}`,
          entry._id,
          io
        );
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
      assignedTo, // Array of user IDs
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

    // Validate assignedTo if provided
    let validatedAssignedTo = [];
    if (assignedTo && Array.isArray(assignedTo) && assignedTo.length > 0) {
      for (const userId of assignedTo) {
        if (mongoose.Types.ObjectId.isValid(userId)) {
          const user = await User.findById(userId);
          if (!user) {
            return res.status(400).json({
              success: false,
              message: `Invalid user ID in assignedTo: ${userId}`,
            });
          }
          validatedAssignedTo.push(userId);
        } else {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format in assignedTo: ${userId}`,
          });
        }
      }
    }

    // Check if assignedTo has changed
    const assignedToChanged =
      JSON.stringify(entry.assignedTo) !== JSON.stringify(validatedAssignedTo);

    // Create history entry if relevant fields changed
    let historyEntry = {};

    if (status !== undefined && status !== entry.status) {
      historyEntry = {
        status,
        remarks: remarks || "Status updated",
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        estimatedValue: estimatedValue
          ? Number(estimatedValue)
          : entry.estimatedValue,
        products: products || entry.products,
        assignedTo: validatedAssignedTo, // Always include current assignedTo
        timestamp: new Date(),
      };
    } else if (remarks !== undefined && remarks !== entry.remarks) {
      historyEntry = {
        status: entry.status,
        remarks,
        liveLocation: liveLocation || entry.liveLocation,
        products: products || entry.products,
        assignedTo: validatedAssignedTo, // Always include current assignedTo
        timestamp: new Date(),
      };
    } else if (
      products !== undefined &&
      JSON.stringify(products) !== JSON.stringify(entry.products)
    ) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Products updated",
        liveLocation: liveLocation || entry.liveLocation,
        products,
        assignedTo: validatedAssignedTo, // Always include current assignedTo
        timestamp: new Date(),
      };
    } else if (assignedTo !== undefined && assignedToChanged) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Assigned users updated",
        liveLocation: liveLocation || entry.liveLocation,
        products: products || entry.products,
        assignedTo: validatedAssignedTo, // Always include current assignedTo
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
        historyEntry.status = entry.status;
        historyEntry.remarks = remarks || "Person meet updated";
        historyEntry.liveLocation = liveLocation || entry.liveLocation;
        historyEntry.products = products || entry.products;
        historyEntry.assignedTo = validatedAssignedTo; // Ensure assignedTo is included
        historyEntry.timestamp = new Date();
      }
    }

    if (Object.keys(historyEntry).length > 0) {
      if (entry.history.length >= 4) {
        entry.history.shift(); // Remove oldest history entry if limit reached
      }
      entry.history.push(historyEntry);
    }
    // Create notification for update
    await createNotification(
      req.user.id,
      `Entry updated: ${customerName || entry.customerName}`,
      entry._id,
      io
    );

    // Notify assigned users if changed
    if (assignedToChanged) {
      for (const userId of validatedAssignedTo) {
        if (!entry.assignedTo.includes(userId)) {
          await createNotification(
            userId,
            `You have been assigned to an updated entry: ${
              customerName || entry.customerName
            }`,
            entry._id,
            io
          );
        }
      }
      // Notify users who were unassigned
      for (const userId of entry.assignedTo) {
        if (!validatedAssignedTo.includes(userId)) {
          await createNotification(
            userId,
            `You have been unassigned from entry: ${
              customerName || entry.customerName
            }`,
            entry._id,
            io
          );
        }
      }
    }

    // Update entry with new values
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
      ...(assignedTo !== undefined && { assignedTo: validatedAssignedTo }), // Update with array
      updatedAt: new Date(),
    });

    const updatedEntry = await entry.save();

    // Populate all relevant fields for response
    const populatedEntry = await Entry.findById(updatedEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username");

    res.status(200).json({
      success: true,
      data: populatedEntry,
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
const exportentry = async (req, res) => {
  try {
    let query = {};
    const filters = req.query;

    if (req.user.role === "superadmin") {
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

    const ws = XLSX.utils.json_to_sheet(formattedEntries);
    ws["!cols"] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 20 },
      { wch: 15 },
      { wch: 30 },
      { wch: 15 },
      { wch: 15 },
      { wch: 50 },
      { wch: 15 },
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
      { wch: 20 },
      { wch: 30 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
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

const fetchAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Superadmin access required",
      });
    }

    const users = await User.find({})
      .select("_id username email role assignedAdmin")
      .lean();

    console.log("Fetched Users for Superadmin:", users);
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching all users:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
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
    let users;

    if (req.user.role === "superadmin") {
      users = await User.find({})
        .select("_id username email role assignedAdmin")
        .lean();
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        $or: [{ assignedAdmin: req.user.id }, { _id: req.user.id }],
      })
        .select("_id username email role assignedAdmin")
        .lean();
      users = teamMembers;
    } else {
      const user = await User.findById(req.user.id).lean();
      if (!user.assignedAdmin) {
        users = [
          {
            _id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
          },
        ];
      } else {
        users = await User.find({
          assignedAdmin: user.assignedAdmin,
        })
          .select("_id username")
          .lean();
        users.push({
          _id: user._id,
          username: user.username,
        });
      }
    }

    if (!users || users.length === 0) {
      return res.status(200).json([]);
    }

    users.sort((a, b) => a.username.localeCompare(b.username));

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

const fetchTeam = async (req, res) => {
  try {
    let users;

    if (req.user.role === "superadmin") {
      users = await User.find({})
        .select("_id username email role assignedAdmin")
        .lean();
    } else if (req.user.role === "admin") {
      users = await User.find({
        $or: [{ assignedAdmin: req.user.id }, { assignedAdmin: null }],
      })
        .select("_id username email role assignedAdmin")
        .lean();
    } else {
      const user = await User.findById(req.user.id).lean();
      if (!user.assignedAdmin) {
        users = [
          {
            _id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            assignedAdmin: null,
            assignedAdminUsername: "Unassigned",
          },
        ];
      } else {
        users = await User.find({
          assignedAdmin: user.assignedAdmin,
        })
          .select("_id username email role assignedAdmin")
          .lean();
        users.push({
          _id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          assignedAdmin: user.assignedAdmin,
        });
      }
    }

    if (!users || users.length === 0) {
      return res.status(200).json([]);
    }

    const adminIds = [
      ...new Set(
        users.filter((u) => u.assignedAdmin).map((u) => u.assignedAdmin)
      ),
    ];
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username")
      .lean();
    const adminMap = new Map(admins.map((a) => [a._id.toString(), a.username]));

    for (let user of users) {
      user.assignedAdminUsername = user.assignedAdmin
        ? adminMap.get(user.assignedAdmin.toString()) || "Unknown"
        : "Unassigned";
    }

    users.sort((a, b) => a.username.localeCompare(b.username));

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching team:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch team",
      error: error.message,
    });
  }
};

const getUsersForTagging = async (req, res) => {
  try {
    const users = await User.find({})
      .select("_id username")
      .lean()
      .sort({ username: 1 });

    if (!users || users.length === 0) {
      return res.status(200).json([]);
    }

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users for tagging:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users for tagging",
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
    if (!user || user.role === "superadmin") {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot assign a superadmin",
      });
    }

    if (req.user.role === "admin" && user.assignedAdmin) {
      return res.status(403).json({
        success: false,
        message: "User is already assigned to another admin",
      });
    }

    if (user.role === "admin") {
      await User.updateMany(
        { assignedAdmin: user._id },
        { assignedAdmin: req.user.id }
      );
    }

    user.assignedAdmin = req.user.id;
    await user.save();

    // Create notification for assignment
    await createNotification(
      userId,
      `You have been assigned to admin ${req.user.username}`,
      null
    );

    const admin = await User.findById(req.user.id).select("username").lean();
    res.status(200).json({
      success: true,
      message: "User and team assigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmin: user.assignedAdmin,
        assignedAdminUsername: admin ? admin.username : "Unknown",
        role: user.role,
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
    if (!user || user.role === "superadmin") {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot unassign a superadmin",
      });
    }

    if (
      req.user.role === "admin" &&
      (!user.assignedAdmin || user.assignedAdmin.toString() !== req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to unassign this user",
      });
    }

    user.assignedAdmin = null;
    await user.save();

    // Create notification for unassignment
    await createNotification(
      userId,
      `You have been unassigned from your admin`,
      null
    );

    res.status(200).json({
      success: true,
      message: "User unassigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmin: user.assignedAdmin,
        assignedAdminUsername: "Unassigned",
        role: user.role,
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
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in database",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingAttendance && existingAttendance.checkIn) {
      return res.status(400).json({
        success: false,
        message: "Already checked in today",
      });
    }

    const { remarks, checkInLocation } = req.body;

    if (
      !checkInLocation ||
      !checkInLocation.latitude ||
      !checkInLocation.longitude
    ) {
      console.error("Invalid check-in location:", checkInLocation);
      return res.status(400).json({
        success: false,
        message: "Check-in location with latitude and longitude is required",
      });
    }

    const latitude = Number(checkInLocation.latitude);
    const longitude = Number(checkInLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      console.error("Non-numeric coordinates:", checkInLocation);
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude must be valid numbers",
      });
    }

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      checkIn: new Date(),
      checkInLocation: { latitude, longitude },
      remarks: remarks?.trim() || "",
      status: "Present",
    });

    await attendance.save();

    // Create notification for check-in
    await createNotification(
      req.user.id,
      `You checked in at ${new Date().toLocaleTimeString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(201).json({
      success: true,
      message: "Checked in successfully",
      data: populatedAttendance,
    });
  } catch (error) {
    console.error("Check-in error:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to check in",
      error: error.message,
    });
  }
};

const checkOut = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in database",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (!attendance) {
      console.warn("No check-in record found for user:", req.user.id);
      return res.status(400).json({
        success: false,
        message: "No check-in record found for today",
      });
    }

    if (attendance.checkOut) {
      console.warn("Already checked out for user:", req.user.id);
      return res.status(400).json({
        success: false,
        message: "Already checked out today",
      });
    }

    const { remarks, checkOutLocation } = req.body;

    if (
      !checkOutLocation ||
      checkOutLocation.latitude == null ||
      checkOutLocation.longitude == null
    ) {
      console.error("Invalid check-out location:", checkOutLocation);
      return res.status(400).json({
        success: false,
        message: "Check-out location with latitude and longitude is required",
      });
    }

    const latitude = Number(checkOutLocation.latitude);
    const longitude = Number(checkOutLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      console.error("Non-numeric coordinates:", checkOutLocation);
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude must be valid numbers",
      });
    }

    attendance.checkOut = new Date();
    attendance.checkOutLocation = { latitude, longitude };
    attendance.remarks = remarks?.trim() || attendance.remarks || "";
    attendance.status = "Present";

    await attendance.save();

    // Create notification for check-out
    await createNotification(
      req.user.id,
      `You checked out at ${new Date().toLocaleTimeString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: populatedAttendance,
    });
  } catch (error) {
    console.error("Check-out error:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to check out",
      error: error.message,
    });
  }
};

const fetchAttendance = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in database",
      });
    }

    const { page = 1, limit = 10, startDate, endDate } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid page number",
      });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be between 1 and 100",
      });
    }

    let query = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid startDate or endDate format",
        });
      }

      if (start > end) {
        return res.status(400).json({
          success: false,
          message: "startDate cannot be later than endDate",
        });
      }

      query.date = { $gte: start, $lte: end };
    }

    if (req.user.role === "superadmin") {
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      query.user = { $in: [req.user.id, ...teamMemberIds] };
    } else {
      query.user = req.user.id;
    }

    const skip = (pageNum - 1) * limitNum;

    const totalRecords = await Attendance.countDocuments(query);

    const attendance = await Attendance.find(query)
      .populate({
        path: "user",
        select: "username",
        options: { strictPopulate: false },
      })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const formattedAttendance = attendance.map((record) => ({
      ...record,
      user: record.user || { username: "Unknown" },
    }));

    const totalPages = Math.ceil(totalRecords / limitNum);

    res.status(200).json({
      success: true,
      data: formattedAttendance,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Fetch attendance error:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attendance",
      error: error.message,
    });
  }
};

// New endpoint to fetch notifications
const fetchNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    const { page = 1, limit = 10, readStatus } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid page number",
      });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be between 1 and 100",
      });
    }

    let query = { userId: req.user.id };
    if (readStatus === "read") {
      query.read = true;
    } else if (readStatus === "unread") {
      query.read = false;
    }

    const skip = (pageNum - 1) * limitNum;
    const totalRecords = await Notification.countDocuments(query);

    const notifications = await Notification.find(query)
      .populate("entryId", "customerName")
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const totalPages = Math.ceil(totalRecords / limitNum);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

// New endpoint to mark notifications as read
const markNotificationsRead = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found",
      });
    }

    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Notification IDs must be provided as a non-empty array",
      });
    }

    for (const id of notificationIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: `Invalid notification ID: ${id}`,
        });
      }
    }

    await Notification.updateMany(
      { _id: { $in: notificationIds }, userId: req.user.id },
      { read: true }
    );

    res.status(200).json({
      success: true,
      message: "Notifications marked as read successfully",
    });
  } catch (error) {
    console.error("Error marking notifications as read:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
      error: error.message,
    });
  }
};

module.exports = {
  bulkUploadStocks,
  getUsersForTagging,
  fetchAllUsers,
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
  fetchTeam,
  fetchAttendance,
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
};

const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const Notification = require("../Schema/NotificationSchema");
const XLSX = require("xlsx");
const Attendance = require("../Schema/AttendanceSchema");
const schedule = require("node-schedule");

// Helper function to create a notification
const createNotification = async (req, userId, message, entryId = null) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error(`Invalid userId: ${userId}`);
      return null;
    }

    const io = req.app.get("io");
    if (!io) {
      console.error("Socket.IO instance not found");
      return null;
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
    console.log(`Notification created for user ${userId}: ${message}`);

    const notificationData = {
      ...notification.toObject(),
      entryId: validatedEntryId ? { _id: validatedEntryId } : null,
    };

    io.to(userId.toString()).emit("newNotification", notificationData);
    console.log(`Notification emitted to user ${userId}: ${message}`);
    return notificationData;
  } catch (error) {
    console.error(`Error creating notification for user ${userId}:`, error);
    return null;
  }
};

// Schedule daily notification check at midnight
schedule.scheduleJob("0 0 * * *", () => {
  const io = app.get("io");
  if (!io) {
    console.error("Socket.IO instance not found for scheduled notifications");
    return;
  }
  checkDateNotifications(io);
  console.log("Scheduled date notifications check executed");
});

// Check for follow-up and closing date notifications
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
    })
      .populate("createdBy", "username")
      .populate("assignedTo", "username");

    for (const entry of entries) {
      const messagePrefix = entry.followUpDate
        ? `Follow-up due tomorrow for ${entry.customerName}`
        : `Expected closing date tomorrow for ${entry.customerName}`;
      const message = `${messagePrefix} (Entry ID: ${entry._id})`;

      // Notify creator
      if (entry.createdBy) {
        await createNotification(
          { app: { get: () => io } },
          entry.createdBy._id,
          message,
          entry._id
        );
      }

      // Notify assigned users
      if (entry.assignedTo && Array.isArray(entry.assignedTo)) {
        for (const user of entry.assignedTo) {
          await createNotification(
            { app: { get: () => io } },
            user._id,
            message,
            entry._id
          );
        }
      }
    }
  } catch (error) {
    console.error("Error in date-based notifications:", error);
  }
};

// Data Entry Logic
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

    // Validate assignedTo
    let validatedAssignedTo = [];
    if (assignedTo && Array.isArray(assignedTo) && assignedTo.length > 0) {
      for (const userId of assignedTo) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format: ${userId}`,
          });
        }
        const user = await User.findById(userId);
        if (!user) {
          return res.status(400).json({
            success: false,
            message: `User not found: ${userId}`,
          });
        }
        validatedAssignedTo.push(userId);
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

    // Create notifications
    await createNotification(
      req,
      req.user.id,
      `New entry created: ${customerName}`,
      newEntry._id
    );
    for (const userId of validatedAssignedTo) {
      await createNotification(
        req,
        userId,
        `Assigned to new entry: ${customerName}`,
        newEntry._id
      );
    }

    const populatedEntry = await Entry.findById(newEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username");

    res.status(201).json({
      success: true,
      data: populatedEntry,
      message: "Entry created successfully",
    });
  } catch (error) {
    console.error("Error in DataentryLogic:", error);

    let userMessage =
      "Something went wrong on our side. Please try again later.";

    // Customize message for known error cases
    if (error.message.includes("Cast to ObjectId failed")) {
      userMessage =
        "There was an issue with the provided user or entry ID. Please refresh and try again.";
    } else if (error.message.includes("validation failed")) {
      userMessage =
        "Some data entered is invalid or missing. Please check your input and try again.";
    } else if (error.message.includes("duplicate")) {
      userMessage = "This entry already exists.";
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Fetch Entries
const fetchEntries = async (req, res) => {
  try {
    let entries = [];

    if (req.user.role === "superadmin") {
      entries = await Entry.find()
        .populate("createdBy", "username role assignedAdmins")
        .populate("assignedTo", "username role assignedAdmins")
        .lean();
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmins: req.user.id,
      }).select("_id role");
      let teamMemberIds = teamMembers.map((member) => member._id);

      const adminIds = teamMembers
        .filter((member) => member.role === "admin")
        .map((admin) => admin._id);
      const nestedMembers = await User.find({
        assignedAdmins: { $in: adminIds },
      }).select("_id");
      teamMemberIds = [
        ...new Set([
          ...teamMemberIds,
          ...nestedMembers.map((member) => member._id),
        ]),
      ];

      entries = await Entry.find({
        $or: [
          { createdBy: req.user.id },
          { createdBy: { $in: teamMemberIds } },
          { assignedTo: req.user.id },
          { assignedTo: { $in: teamMemberIds } },
        ],
      })
        .populate("createdBy", "username role assignedAdmins")
        .populate("assignedTo", "username role assignedAdmins")
        .lean();
    } else {
      entries = await Entry.find({
        $or: [{ createdBy: req.user.id }, { assignedTo: req.user.id }],
      })
        .populate("createdBy", "username role assignedAdmins")
        .populate("assignedTo", "username role assignedAdmins")
        .lean();
    }

    res.status(200).json(entries);
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch entries",
      error: error.message,
    });
  }
};

// Delete Entry
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
        assignedAdmins: req.user.id,
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

    // Notifications
    await createNotification(
      req,
      req.user.id,
      `Entry deleted: ${entry.customerName}`,
      entry._id
    );
    for (const userId of entry.assignedTo || []) {
      await createNotification(
        req,
        userId,
        `Entry deleted: ${entry.customerName}`,
        entry._id
      );
    }

    await Entry.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Entry deleted successfully" });
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we are unable to load the entries right now. Please try again later.",
      // Optionally, include error details only in dev mode:
      // error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Edit Entry
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
      assignedTo,
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

    // Validate assignedTo
    let validatedAssignedTo = [];
    if (assignedTo && Array.isArray(assignedTo)) {
      for (const userId of assignedTo) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format: ${userId}`,
          });
        }
        const user = await User.findById(userId);
        if (!user) {
          return res.status(400).json({
            success: false,
            message: `User not found: ${userId}`,
          });
        }
        validatedAssignedTo.push(userId);
      }
    }

    const assignedToChanged =
      JSON.stringify(entry.assignedTo) !== JSON.stringify(validatedAssignedTo);

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
        assignedTo: validatedAssignedTo,
        timestamp: new Date(),
      };
    } else if (remarks !== undefined && remarks !== entry.remarks) {
      historyEntry = {
        status: entry.status,
        remarks,
        liveLocation: liveLocation || null,
        products: products || entry.products,
        assignedTo: validatedAssignedTo,
        timestamp: new Date(),
      };
    } else if (
      products !== undefined &&
      JSON.stringify(products) !== JSON.stringify(entry.products)
    ) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Products updated",
        liveLocation: liveLocation || null,
        products,
        assignedTo: validatedAssignedTo,
        timestamp: new Date(),
      };
    } else if (assignedTo !== undefined && assignedToChanged) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Assigned users updated",
        liveLocation: liveLocation || null,
        products: products || entry.products,
        assignedTo: validatedAssignedTo,
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
        historyEntry.assignedTo = validatedAssignedTo;
        historyEntry.timestamp = new Date();
      }
    }

    if (Object.keys(historyEntry).length > 0) {
      if (entry.history.length >= 10) {
        entry.history.shift();
      }
      entry.history.push(historyEntry);
    }

    if (assignedToChanged) {
      await Promise.all([
        ...validatedAssignedTo.map(async (userId) => {
          if (!entry.assignedTo.includes(userId)) {
            await createNotification(
              req,
              userId,
              `Assigned to updated entry: ${
                customerName || entry.customerName
              }`,
              entry._id
            );
          }
        }),
        ...entry.assignedTo.map(async (userId) => {
          if (!validatedAssignedTo.includes(userId)) {
            await createNotification(
              req,
              userId,
              `Unassigned from entry: ${customerName || entry.customerName}`,
              entry._id
            );
          }
        }),
      ]);
    }

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
      ...(remarks !== undefined && { remarks: remarks.trim() }),
      ...(nextAction !== undefined && { nextAction: nextAction.trim() }),
      ...(estimatedValue !== undefined && {
        estimatedValue: Number(estimatedValue),
      }),
      ...(closeamount !== undefined && { closeamount: Number(closeamount) }),
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
      ...(assignedTo !== undefined && { assignedTo: validatedAssignedTo }),
      updatedAt: new Date(),
    });

    const updatedEntry = await entry.save();

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
    console.error("Error in editEntry:", error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({
        success: false,
        message:
          "Some input values are invalid. Please review and correct them.",
        errors,
      });
    }
    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while updating the entry. Please try again later.",
      // error: error.message,
    });
  }
};

// Bulk Upload Stocks
const bulkUploadStocks = async (req, res) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      console.error(
        "MongoDB not connected, state:",
        mongoose.connection.readyState
      );
      return res.status(500).json({
        success: false,
        message: "Database connection error",
      });
    }

    if (!req.user?.id) {
      console.error("No authenticated user found");
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const newEntries = Array.isArray(req.body) ? req.body : [];
    if (!newEntries.length) {
      return res
        .status(400)
        .json({ success: false, message: "No entries provided" });
    }

    const entriesWithMetadata = [];
    const errors = [];

    for (const [index, entry] of newEntries.entries()) {
      try {
        console.log(
          `Processing entry ${index}:`,
          JSON.stringify(entry, null, 2)
        );

        // Validate mobile number
        if (entry.mobileNumber && !/^\d{10}$/.test(entry.mobileNumber)) {
          throw new Error(`Invalid mobile number: ${entry.mobileNumber}`);
        }

        // Validate products
        const products = Array.isArray(entry.products)
          ? entry.products.map((p) => ({
              name: String(p.name || ""),
              specification: String(p.specification || ""),
              size: String(p.size || ""),
              quantity: Number(p.quantity || 1),
            }))
          : [];

        // Validate dates
        const expectedClosingDate = entry.expectedClosingDate
          ? new Date(entry.expectedClosingDate)
          : null;
        if (expectedClosingDate && isNaN(expectedClosingDate.getTime())) {
          throw new Error(
            `Invalid expectedClosingDate: ${entry.expectedClosingDate}`
          );
        }

        const followUpDate = entry.followUpDate
          ? new Date(entry.followUpDate)
          : null;
        if (followUpDate && isNaN(followUpDate.getTime())) {
          throw new Error(`Invalid followUpDate: ${entry.followUpDate}`);
        }

        // Validate assignedTo (ensure valid ObjectIds)
        const assignedTo = Array.isArray(entry.assignedTo)
          ? entry.assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
          : [];

        const formattedEntry = {
          customerName: String(entry.customerName || ""),
          mobileNumber: String(entry.mobileNumber || ""),
          contactperson: String(entry.contactperson || ""),
          address: String(entry.address || ""),
          state: String(entry.state || ""),
          city: String(entry.city || ""),
          organization: String(entry.organization || ""),
          category: String(entry.category || ""),
          type: String(entry.type || ""),
          status: entry.status || "Not Found",
          closetype: entry.closetype || "",
          estimatedValue: Number(entry.estimatedValue || 0),
          closeamount: Number(entry.closeamount || 0),
          remarks: String(entry.remarks || ""),
          liveLocation: String(entry.liveLocation || ""),
          nextAction: String(entry.nextAction || ""),
          firstPersonMeet: String(entry.firstPersonMeet || ""),
          secondPersonMeet: String(entry.secondPersonMeet || ""),
          thirdPersonMeet: String(entry.thirdPersonMeet || ""),
          fourthPersonMeet: String(entry.fourthPersonMeet || ""),
          expectedClosingDate,
          followUpDate,
          products,
          assignedTo,
          createdBy: req.user.id,
          createdAt: new Date(),
          history: [
            {
              status: entry.status || "Not Found",
              remarks: entry.remarks || "Bulk upload entry",
              liveLocation: entry.liveLocation || null,
              products,
              assignedTo,
              timestamp: new Date(),
              firstPersonMeet: String(entry.firstPersonMeet || ""),
              secondPersonMeet: String(entry.secondPersonMeet || ""),
              thirdPersonMeet: String(entry.thirdPersonMeet || ""),
              fourthPersonMeet: String(entry.fourthPersonMeet || ""),
            },
          ],
        };

        // Validate with Mongoose schema
        const entryDoc = new Entry(formattedEntry);
        await entryDoc.validate();

        entriesWithMetadata.push(formattedEntry);
      } catch (validationError) {
        console.error(
          `Validation error for entry ${index}:`,
          validationError.message
        );
        errors.push({ entryIndex: index, error: validationError.message });
      }
    }

    if (!entriesWithMetadata.length) {
      return res.status(400).json({
        success: false,
        message: "No valid entries to upload",
        errors,
      });
    }

    const batchSize = 500;
    let insertedCount = 0;

    for (let i = 0; i < entriesWithMetadata.length; i += batchSize) {
      const batch = entriesWithMetadata.slice(i, i + batchSize);
      console.log(`Inserting batch of ${batch.length} entries`);
      try {
        const insertedEntries = await Entry.insertMany(batch, {
          ordered: false,
          rawResult: true,
        });

        console.log(
          "InsertMany result:",
          JSON.stringify(insertedEntries, null, 2)
        );
        insertedCount +=
          insertedEntries.insertedCount || insertedEntries.length || 0;

        // Process notifications
        for (const entry of insertedEntries.ops || []) {
          try {
            await createNotification(
              req,
              req.user.id,
              `Bulk entry created: ${entry.customerName || "Unknown"}`,
              entry._id
            );
            for (const userId of entry.assignedTo || []) {
              await createNotification(
                req,
                userId,
                `Assigned to bulk entry: ${entry.customerName || "Unknown"}`,
                entry._id
              );
            }
          } catch (notificationError) {
            console.error(
              `Notification error for entry ${entry._id}:`,
              notificationError.message
            );
            errors.push({
              entry: entry._id,
              error: `Notification failed: ${notificationError.message}`,
            });
          }
        }
      } catch (batchError) {
        console.error(`Batch ${i / batchSize + 1} error:`, batchError.message);
        errors.push({ batch: i / batchSize + 1, error: batchError.message });
      }
    }

    console.log(
      `Inserted ${insertedCount} of ${entriesWithMetadata.length} entries`
    );
    return res.status(201).json({
      success: insertedCount > 0,
      message: `Uploaded ${insertedCount} entries`,
      count: insertedCount,
      errors: errors.length ? errors : null,
    });
  } catch (error) {
    console.error("Bulk upload error:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to process entries",
      error: error.message,
    });
  }
};

// Export Entries
const exportentry = async (req, res) => {
  try {
    let query = {};
    const filters = req.query;

    if (req.user.role === "superadmin") {
      // No restrictions
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmins: req.user.id,
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
    if (filters.fromDate && filters.toDate) {
      query.createdAt = {
        $gte: new Date(filters.fromDate),
        $lte: new Date(filters.toDate),
      };
    }

    const entries = await Entry.find(query)
      .populate("createdBy", "username role assignedAdmins")
      .populate("assignedTo", "username role assignedAdmins")
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
          ?.map(
            (p) =>
              `${p.name} (${p.specification}, ${p.size}, Qty: ${p.quantity})`
          )
          .join("; ") || "N/A",
      Type: entry.type || "Customer",
      Organization: entry.organization || "N/A",
      Category: entry.category || "N/A",
      Status: entry.status || "Not Found",
      Created_At: entry.createdAt?.toLocaleDateString() || "N/A",
      Created_By: entry.createdBy?.username || "Unknown",
      Assigned_To:
        entry.assignedTo?.map((user) => user.username).join(", ") ||
        "Unassigned",
      Close_Type: entry.closetype || "Not Set",
      Expected_Closing_Date: entry.expectedClosingDate
        ? entry.expectedClosingDate.toLocaleDateString()
        : "Not Set",
      FollowUp_Date: entry.followUpDate
        ? entry.followUpDate.toLocaleDateString()
        : "Not Set",
      Remarks: entry.remarks || "Not Set",
      Estimated_Value: entry.estimatedValue || "N/A",
      Close_Amount: entry.closeamount || "N/A",
      Next_Action: entry.nextAction || "Not Set",
      Live_Location: entry.liveLocation || "N/A",
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
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 30 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
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
    console.error("Error exporting entries:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting entries",
      error: error.message,
    });
  }
};

// Fetch all users (Superadmin only)
const fetchAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const users = await User.find({})
      .select("_id username email role assignedAdmins")
      .lean();

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We encountered an issue while fetching users. Please try again later.",
      // For security, avoid exposing raw error to users
      // error: error.message,
    });
  }
};

// Get admin status
const getAdmin = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id)
      .select("_id username role assignedAdmins")
      .lean();
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
    console.error("Error fetching user:", error);
    res.status(500).json({
      success: false,
      message:
        "Something went wrong while fetching your information. Please try again later.",
      // error: error.message, // Hide internal error from users
    });
  }
};

// Fetch users (Role-based)
const fetchUsers = async (req, res) => {
  try {
    let users = [];

    if (req.user.role === "superadmin") {
      users = await User.find({})
        .select("_id username email role assignedAdmins")
        .lean();
    } else if (req.user.role === "admin") {
      users = await User.find({
        $or: [{ assignedAdmins: req.user.id }, { _id: req.user.id }],
      })
        .select("_id username email role assignedAdmins")
        .lean();
    } else {
      const user = await User.findById(req.user.id)
        .select("_id username email role assignedAdmins")
        .lean();
      if (!user.assignedAdmins?.length) {
        users.push(user);
      } else {
        users = await User.find({
          assignedAdmins: { $in: user.assignedAdmins },
        })
          .select("_id username email role assignedAdmins")
          .lean();
        users.push(user);
      }
    }

    if (!users.length) return res.status(200).json([]);

    users.sort((a, b) => a.username.localeCompare(b.username));

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while fetching users. Please try again later.",
      // error: error.message,
    });
  }
};

// Fetch team
const fetchTeam = async (req, res) => {
  try {
    console.log("Fetching team for user:", req.user.id, "Role:", req.user.role);

    let users = [];

    if (req.user.role === "superadmin") {
      users = await User.find({ _id: { $ne: req.user.id } })
        .select("_id username email role assignedAdmins")
        .lean();
      console.log("Superadmin users fetched:", users.length);
    } else if (req.user.role === "admin") {
      const allAdmins = await User.find({ role: "admin" })
        .select("_id assignedAdmins")
        .lean();
      const assignedAdminIds = allAdmins
        .filter(
          (admin) =>
            admin.assignedAdmins?.length > 0 &&
            admin._id.toString() !== req.user.id
        )
        .map((admin) => admin._id.toString());

      users = await User.find({
        $or: [
          { assignedAdmins: { $size: 0 } }, // Unassigned users
          { assignedAdmins: req.user.id }, // Users assigned to current admin
          {
            role: "admin",
            _id: { $ne: req.user.id },
            _id: { $nin: assignedAdminIds },
          }, // Unassigned admins
        ],
      })
        .select("_id username email role assignedAdmins")
        .lean();
      console.log("Admin users fetched:", users.length);
    } else if (req.user.role === "others") {
      // Fetch assigned admins for "others" role users
      const currentUser = await User.findById(req.user.id)
        .select("_id username email role assignedAdmins")
        .lean();
      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: "Current user not found",
        });
      }
      if (currentUser.assignedAdmins?.length > 0) {
        users = await User.find({
          _id: { $in: currentUser.assignedAdmins },
        })
          .select("_id username email role assignedAdmins")
          .lean();
      } else {
        users = [currentUser]; // Show only themselves if no assigned admins
      }
      console.log("Others users fetched:", users.length);
    } else {
      console.log("Unknown role, returning empty list");
      return res.status(200).json([]);
    }

    if (!users.length) {
      console.log("No users found, returning empty array");
      return res.status(200).json([]);
    }

    // Fetch all admins for username mapping
    const adminIds = [
      ...new Set(
        users
          .flatMap((u) => u.assignedAdmins || [])
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ];
    console.log("Admin IDs for mapping:", adminIds);
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username role")
      .lean();
    const adminMap = new Map(
      admins.map((a) => [
        a._id.toString(),
        { username: a.username, role: a.role },
      ])
    );

    for (const user of users) {
      user.assignedAdminUsernames =
        user.assignedAdmins
          ?.map((id) => adminMap.get(id.toString())?.username || "Unknown")
          .filter((username) => username !== "Unknown")
          .join(", ") || "Unassigned";
    }

    users.sort((a, b) => a.username.localeCompare(b.username));

    console.log("Final users sent to frontend:", users.length);
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching team:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't retrieve the team information right now. Please try again later or contact support if the issue continues.",
      // error: error.message,
    });
  }
};
// Get users for tagging
const getUsersForTagging = async (req, res) => {
  try {
    const users = await User.find({})
      .select("_id username")
      .sort({ username: 1 })
      .lean();

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users for tagging:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't load the user list for tagging right now. Please try again later or contact support if the problem continues.",
      // error: error.message,
    });
  }
};

// Assign user to admin
const assignUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "Cannot assign yourself",
      });
    }

    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user || user.role === "superadmin") {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot assign superadmin",
      });
    }

    if (!user.assignedAdmins) user.assignedAdmins = [];
    if (user.assignedAdmins.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: "User is already assigned to you",
      });
    }

    // Assign the user to the current admin
    user.assignedAdmins.push(req.user.id);
    await user.save();

    // If the assigned user is an admin, assign their team as well
    if (user.role === "admin") {
      const teamMembers = await User.find({ assignedAdmins: user._id });
      for (const teamMember of teamMembers) {
        if (!teamMember.assignedAdmins) teamMember.assignedAdmins = [];
        if (!teamMember.assignedAdmins.includes(req.user.id)) {
          teamMember.assignedAdmins.push(req.user.id);
          await teamMember.save();
          await createNotification(
            req,
            teamMember._id,
            `Assigned to admin: ${req.user.username} via admin ${user.username}`,
            null
          );
        }
      }
    }

    await createNotification(
      req,
      userId,
      `Assigned to admin: ${req.user.username}`,
      null
    );

    const adminIds = user.assignedAdmins;
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username")
      .lean();
    const adminMap = new Map(admins.map((a) => [a._id.toString(), a.username]));

    res.status(200).json({
      success: true,
      message: "User and team assigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmins: user.assignedAdmins,
        assignedAdminUsernames:
          user.assignedAdmins
            .map((id) => adminMap.get(id.toString()) || "Unknown")
            .join(", ") || "Unassigned",
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error assigning user:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't assign the user right now. Please try again later or contact support if this issue continues.",
      // error: error.message,
    });
  }
};

// Unassign user from admin
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
        message: "User not found or cannot unassign superadmin",
      });
    }

    if (!user.assignedAdmins?.length) {
      return res.status(400).json({
        success: false,
        message: "User is not assigned to any admin",
      });
    }

    // Check if user is assigned by a superadmin
    const assignedBySuperAdmin = await User.findOne({
      _id: { $in: user.assignedAdmins },
      role: "superadmin",
    });

    if (
      req.user.role === "admin" &&
      assignedBySuperAdmin &&
      !user.assignedAdmins.includes(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Cannot unassign user assigned by superadmin",
      });
    }

    // Superadmin can unassign anyone, admins can unassign their own or non-superadmin-assigned users
    if (
      req.user.role === "superadmin" ||
      user.assignedAdmins.includes(req.user.id) ||
      (!assignedBySuperAdmin && req.user.role === "admin")
    ) {
      const isForceUnassign =
        req.user.role === "superadmin" &&
        !user.assignedAdmins.includes(req.user.id);

      if (isForceUnassign) {
        user.assignedAdmins = [];
      } else {
        user.assignedAdmins = user.assignedAdmins.filter(
          (id) => id.toString() !== req.user.id
        );
      }

      if (user.role === "admin") {
        // Unassign the admin's team appropriately
        const teamMembers = await User.find({ assignedAdmins: user._id });
        for (const teamMember of teamMembers) {
          if (isForceUnassign) {
            // For force unassign, remove the sub-admin (user._id) from team member's assignedAdmins
            teamMember.assignedAdmins = teamMember.assignedAdmins.filter(
              (id) => id.toString() !== user._id.toString()
            );
          } else {
            // Normal case: remove the top-level admin (req.user.id) from team member's assignedAdmins
            teamMember.assignedAdmins = teamMember.assignedAdmins.filter(
              (id) => id.toString() !== req.user.id
            );
          }
          await teamMember.save();
          await createNotification(
            req,
            teamMember._id,
            `Unassigned from admin: ${req.user.username}`,
            null
          );
        }
      }

      await user.save();

      await createNotification(
        req,
        userId,
        `Unassigned from admin: ${req.user.username}`,
        null
      );

      res.status(200).json({
        success: true,
        message: "User and team unassigned successfully",
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to unassign this user",
      });
    }
  } catch (error) {
    console.error("Error unassigning user:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't complete the unassignment right now. Please try again later or contact support if this keeps happening.",
      // error: error.message,
    });
  }
};
// Get current user
const getCurrentUser = async (req, res) => {
  try {
    console.log("Fetching current user:", req.user.id);
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      console.error("Invalid user ID:", req.user.id);
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const user = await User.findById(req.user.id)
      .select("_id username email role assignedAdmins")
      .lean();

    if (!user) {
      console.error("User not found:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("Current user fetched:", user.username);
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't retrieve your user information right now. Please try again later or contact support if the issue continues.",
      // error: error.message,
    });
  }
};

// Check-in
const checkIn = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to check in.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "You have already checked in today.",
      });
    }

    const { remarks, checkInLocation } = req.body;

    if (
      !checkInLocation ||
      !checkInLocation.latitude ||
      !checkInLocation.longitude
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid check-in location.",
      });
    }

    const latitude = Number(checkInLocation.latitude);
    const longitude = Number(checkInLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates provided for location.",
      });
    }

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      checkIn: new Date().toISOString(),
      checkInLocation: { latitude, longitude },
      remarks: remarks?.trim() || null,
      status: "Present",
    });

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Checked in at ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(201).json({
      success: true,
      message: "Checked in successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Check-in error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't complete your check-in at the moment. Please try again shortly, or contact support if the problem persists.",
      // error: error.message,
    });
  }
};
// checkOut endpoint
const checkOut = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to check out.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "No check-in found for today. Please check in first.",
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: "You have already checked out today.",
      });
    }

    const { remarks, checkOutLocation } = req.body;

    if (
      !checkOutLocation ||
      checkOutLocation.latitude == null ||
      checkOutLocation.longitude == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid location to check out.",
      });
    }

    const latitude = Number(checkOutLocation.latitude);
    const longitude = Number(checkOutLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates provided for location.",
      });
    }

    attendance.checkOut = new Date().toISOString();
    attendance.checkOutLocation = { latitude, longitude };
    attendance.remarks = remarks?.trim() || attendance.remarks || "";
    attendance.status = "Present";

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Checked out at ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Check-out error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while checking you out. Please try again later or contact support if the issue persists.",
      // error: error.message,
    });
  }
};
// Fetch attendance
const fetchAttendance = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      selectedUserId,
    } = req.query;
    console.log(
      "Received attendance request with selectedUserId:",
      selectedUserId
    );
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid page number" });
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
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
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

    // Apply user filter if selectedUserId is provided
    if (selectedUserId) {
      if (user.role === "superadmin") {
        // Superadmin can filter by any user
        query.user = selectedUserId;
      } else if (user.role === "admin") {
        // Admin can only filter by their team members or themselves
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        const allowedUserIds = [req.user.id, ...teamMemberIds];

        if (
          allowedUserIds
            .map((id) => id.toString())
            .includes(selectedUserId.toString())
        ) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your team members",
          });
        }
      } else {
        // Regular users can only filter by themselves
        if (selectedUserId === req.user.id) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your own attendance",
          });
        }
      }
    } else {
      // If no selectedUserId, apply role-based restrictions
      if (user.role === "superadmin") {
        // No restrictions for superadmin
      } else if (user.role === "admin") {
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        query.user = { $in: [req.user.id, ...teamMemberIds] };
      } else {
        query.user = req.user.id;
      }
    }

    console.log(
      `Fetching attendance for user: ${req.user.id}, query: ${JSON.stringify(
        query
      )}`
    );

    const skip = (pageNum - 1) * limitNum;

    const totalRecords = await Attendance.countDocuments(query);
    console.log(`Total records: ${totalRecords}`);

    const attendance = await Attendance.find(query)
      .populate("user", "username")
      .sort({ date: -1, _id: -1 }) // Sort by date and _id to ensure consistent order
      .skip(skip)
      .limit(limitNum)
      .lean();

    console.log(`Fetched records: ${JSON.stringify(attendance)}`);

    const formattedAttendance = attendance.map((record) => ({
      ...record,
      user: record.user || { username: "Unknown" },
      date: record.date ? new Date(record.date).toISOString() : null,
      checkIn: record.checkIn ? new Date(record.checkIn).toISOString() : null,
      checkOut: record.checkOut
        ? new Date(record.checkOut).toISOString()
        : null,
    }));

    res.status(200).json({
      success: true,
      data: formattedAttendance,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Fetch attendance error:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn’t load attendance data at this time. Please try again later or contact support if the issue persists.",
      // error: error.message,
    });
  }
};
// Fetch notifications
const fetchNotifications = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { page = 1, limit = 10, readStatus } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid page number" });
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

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

// Mark notifications as read
const markNotificationsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || !notificationIds.length) {
      return res.status(400).json({
        success: false,
        message: "Notification IDs required",
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
      message: "Notifications marked as read",
    });
  } catch (error) {
    console.error("Error marking notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications",
      error: error.message,
    });
  }
};

// Clear notifications
const clearNotifications = async (req, res) => {
  try {
    if (!req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await Notification.deleteMany({ userId: req.user.id });

    req.app.get("io").to(req.user.id).emit("notificationsCleared");

    res.status(200).json({
      success: true,
      message: "Notifications cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
      error: error.message,
    });
  }
};

const exportAttendance = async (req, res) => {
  try {
    // Authenticate user
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Validate query parameters
    const { startDate, endDate, selectedUserId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be later than end date",
      });
    }

    // Build query based on user role and selectedUserId
    let query = {
      date: { $gte: start, $lte: end },
    };

    // Apply user filter if selectedUserId is provided
    if (selectedUserId) {
      if (user.role === "superadmin") {
        // Superadmin can filter by any user
        query.user = selectedUserId;
      } else if (user.role === "admin") {
        // Admin can only filter by their team members or themselves
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        const allowedUserIds = [req.user.id, ...teamMemberIds];
        if (
          allowedUserIds
            .map((id) => id.toString())
            .includes(selectedUserId.toString())
        ) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your team members",
          });
        }
      } else {
        // Regular users can only filter by themselves
        if (selectedUserId === req.user.id) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your own attendance",
          });
        }
      }
    } else {
      // If no selectedUserId, apply role-based restrictions
      if (user.role === "superadmin") {
        // No restrictions for superadmin
      } else if (user.role === "admin") {
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        query.user = { $in: [req.user.id, ...teamMemberIds] };
      } else {
        query.user = req.user.id;
      }
    }

    console.log(`Exporting attendance with query: ${JSON.stringify(query)}`);

    // Fetch attendance records
    const attendance = await Attendance.find(query)
      .populate("user", "username")
      .sort({ date: -1, _id: -1 }) // Preserve duplicates with consistent sorting
      .lean();

    if (!attendance.length) {
      return res.status(404).json({
        success: false,
        message: "No attendance records found for the specified date range",
      });
    }

    // Function to format date and time in IST
    const formatInIST = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        console.warn(`Invalid date: ${date}`);
        return null;
      }
      return new Date(date);
    };

    // Format attendance data for Excel
    const formattedAttendance = attendance.map((record) => {
      const dateIST = formatInIST(record.date);
      const checkInIST = record.checkIn ? formatInIST(record.checkIn) : null;
      const checkOutIST = record.checkOut ? formatInIST(record.checkOut) : null;

      // Log raw and formatted times for debugging
      console.log(`Record ID: ${record._id}`);
      console.log(
        `Raw date: ${record.date}, Formatted date: ${dateIST?.toISOString()}`
      );
      console.log(
        `Raw checkIn: ${
          record.checkIn
        }, Formatted checkIn: ${checkInIST?.toISOString()}`
      );
      console.log(
        `Raw checkOut: ${
          record.checkOut
        }, Formatted checkOut: ${checkOutIST?.toISOString()}`
      );

      return {
        Date: dateIST
          ? dateIST.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              timeZone: "Asia/Kolkata", // Explicitly set to IST
            }) // Formats as DD/MM/YYYY
          : "N/A",
        Employee: record.user?.username || "Unknown",
        Check_In: checkInIST
          ? checkInIST.toLocaleTimeString("en-US", {
              hour12: true,
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Asia/Kolkata", // Explicitly set to IST
            })
          : "N/A",
        Check_Out: checkOutIST
          ? checkOutIST.toLocaleTimeString("en-US", {
              hour12: true,
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Asia/Kolkata", // Explicitly set to IST
            })
          : "N/A",
        Status: record.status || "N/A",
        Remarks: record.remarks || "N/A",
      };
    });

    // Create Excel worksheet
    const ws = XLSX.utils.json_to_sheet(formattedAttendance);
    ws["!cols"] = [
      { wch: 15 }, // Date
      { wch: 20 }, // Employee
      { wch: 15 }, // Check_In
      { wch: 15 }, // Check_Out
      { wch: 10 }, // Status
      { wch: 30 }, // Remarks
    ];

    // Create Excel workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");

    // Generate and send file
    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Attendance_${startDate}_to_${endDate}.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error exporting attendance:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, something went wrong while exporting attendance. Please try again later or contact support.",
      // error: error.message,
    });
  }
};
const markLeave = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to mark leave.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "Attendance already marked for today.",
      });
    }

    const { remarks } = req.body;

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      remarks: remarks?.trim() || null,
      status: "Leave",
    });

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Marked leave on ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(201).json({
      success: true,
      message: "Leave marked successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Mark leave error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't mark your leave at the moment. Please try again shortly, or contact support if the problem persists.",
    });
  }
};
module.exports = {
  markLeave,
  bulkUploadStocks,
  getUsersForTagging,
  fetchAllUsers,
  DataentryLogic,
  fetchEntries,
  DeleteData,
  editEntry,
  exportentry,
  exportAttendance,
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
  getCurrentUser,
};

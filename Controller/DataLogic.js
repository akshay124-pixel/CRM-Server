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
      assignedTo, // Array of user IDs
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
      assignedTo: validatedAssignedTo, // Ensure assignedTo is included
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
      assignedTo: validatedAssignedTo, // Store validated assigned users
      history: [historyEntry], // Include history entry with assignedTo
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await newEntry.save();

    // Populate createdBy, assignedTo, and history.assignedTo for response
    const populatedEntry = await Entry.findById(newEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username"); // Populate assignedTo in history

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
const bulkUploadStocks = async (req, res) => {
  try {
    const newEntries = req.body;

    // Add createdBy and createdAt to each entry
    const entriesWithMetadata = newEntries.map((entry) => ({
      ...entry,
      createdBy: req.user.id,
      createdAt: entry.Created_At ? new Date(entry.Created_At) : new Date(),
    }));

    const batchSize = 500;
    for (let i = 0; i < entriesWithMetadata.length; i += batchSize) {
      const batch = entriesWithMetadata.slice(i, i + batchSize);
      await Entry.insertMany(batch, { ordered: false });
    }

    res.status(201).json({
      success: true,
      message: "Entries uploaded successfully!",
      count: entriesWithMetadata.length,
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
    // Ensure only superadmin can access this endpoint
    if (req.user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Superadmin access required",
      });
    }

    const users = await User.find({})
      .select("_id username email role assignedAdmin")
      .lean();

    console.log("Fetched Users for Superadmin:", users); // Log for debugging
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

// Updated Fetch User
const fetchUsers = async (req, res) => {
  try {
    let users;

    if (req.user.role === "superadmin") {
      // Superadmin sees all users
      users = await User.find({})
        .select("_id username email role assignedAdmin")
        .lean();
    } else if (req.user.role === "admin") {
      // Admin sees their team and themselves
      const teamMembers = await User.find({
        $or: [{ assignedAdmin: req.user.id }, { _id: req.user.id }],
      })
        .select("_id username email role assignedAdmin")
        .lean();
      users = teamMembers;
    } else {
      // Non-admin users (e.g., "others") see only users under the same admin
      const user = await User.findById(req.user.id).lean();
      if (!user.assignedAdmin) {
        // If no assigned admin, return only the user themselves
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
        // Include the user themselves
        users.push({
          _id: user._id,
          username: user.username,
        });
      }
    }

    if (!users || users.length === 0) {
      return res.status(200).json([]);
    }

    // Sort users by username for consistency
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
// Team bulider Api
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

    // Fetch all admin usernames in one query
    const adminIds = [
      ...new Set(
        users.filter((u) => u.assignedAdmin).map((u) => u.assignedAdmin)
      ),
    ];
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username")
      .lean();
    const adminMap = new Map(admins.map((a) => [a._id.toString(), a.username]));

    // Populate assignedAdminUsername
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
// New endpoint for fetching all users for tagging
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

    // Admins can only assign unassigned users
    if (req.user.role === "admin" && user.assignedAdmin) {
      return res.status(403).json({
        success: false,
        message: "User is already assigned to another admin",
      });
    }

    // If assigning an admin, reassign their entire team
    if (user.role === "admin") {
      await User.updateMany(
        { assignedAdmin: user._id },
        { assignedAdmin: req.user.id }
      );
    }

    user.assignedAdmin = req.user.id;
    await user.save();

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

    // Admins can only unassign their own team members
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

    console.log("Check-in request body:", req.body);

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

    // Convert coordinates to numbers
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

    console.log("Check-out request:", {
      userId: req.user.id,
      body: req.body,
    });

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

    // Extract pagination and filter parameters
    const { page = 1, limit = 10, startDate, endDate } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate pagination parameters
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

    // Apply date filters if provided
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

    // Apply user-based filters
    if (req.user.role === "superadmin") {
      // Superadmin can access all records
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmin: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      query.user = { $in: [req.user.id, ...teamMemberIds] };
    } else {
      query.user = req.user.id;
    }

    // Calculate skip for pagination
    const skip = (pageNum - 1) * limitNum;

    // Fetch total records for pagination metadata
    const totalRecords = await Attendance.countDocuments(query);

    // Fetch paginated attendance records
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

    // Calculate total pages
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
};

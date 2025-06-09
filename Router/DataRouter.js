const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/config jwt");
const {
  checkIn,
  checkOut,
  fetchAttendance,
  fetchAllUsers,
} = require("../Controller/DataLogic");

router.post("/check-in", verifyToken, checkIn);
router.post("/check-out", verifyToken, checkOut);
router.get("/attendance", verifyToken, fetchAttendance);
router.get("/allusers", verifyToken, fetchAllUsers);
// Other routes from your original DataRoute.js
router.post(
  "/entry",
  verifyToken,
  require("../Controller/DataLogic").DataentryLogic
);
router.get(
  "/fetch-entry",
  verifyToken,
  require("../Controller/DataLogic").fetchEntries
);
router.get(
  "/fetch-team",
  verifyToken,
  require("../Controller/DataLogic").fetchTeam
);
router.delete(
  "/entry/:id",
  verifyToken,
  require("../Controller/DataLogic").DeleteData
);
router.put("/editentry/:id", require("../Controller/DataLogic").editEntry);
router.get(
  "/export",
  verifyToken,
  require("../Controller/DataLogic").exportentry
);
router.post(
  "/entries",
  verifyToken,
  require("../Controller/DataLogic").bulkUploadStocks
);
router.get(
  "/user-role",
  verifyToken,
  require("../Controller/DataLogic").getAdmin
);
router.get(
  "/tag-users",
  verifyToken,
  require("../Controller/DataLogic").getUsersForTagging
);
router.get(
  "/users",
  verifyToken,
  require("../Controller/DataLogic").fetchUsers
);
router.post(
  "/assign-user",
  verifyToken,
  require("../Controller/DataLogic").assignUser
);
router.post(
  "/unassign-user",
  verifyToken,
  require("../Controller/DataLogic").unassignUser
);

module.exports = router;

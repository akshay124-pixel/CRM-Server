const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/config jwt");
const {
  checkIn,
  checkOut,
  fetchAttendance,
  fetchAllUsers,
  DataentryLogic,
  fetchEntries,
  fetchTeam,
  DeleteData,
  editEntry,
  exportentry,
  bulkUploadStocks,
  getAdmin,
  fetchUsers,
  getUsersForTagging,
  assignUser,
  unassignUser,
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
  getCurrentUser,
  exportAttendance,
  markLeave,
} = require("../Controller/DataLogic");

router.post("/check-in", verifyToken, checkIn);
router.post("/check-out", verifyToken, checkOut);
router.get("/attendance", verifyToken, fetchAttendance);
router.post("/leave", verifyToken, markLeave);

router.get("/allusers", verifyToken, fetchAllUsers);
router.post("/entry", verifyToken, DataentryLogic);
router.get("/fetch-entry", verifyToken, fetchEntries);
router.get("/fetch-team", verifyToken, fetchTeam);
router.delete("/entry/:id", verifyToken, DeleteData);
router.put("/editentry/:id", verifyToken, editEntry);
router.get("/export", verifyToken, exportentry);
router.post("/entries", verifyToken, bulkUploadStocks);
router.get("/user-role", verifyToken, getAdmin);
router.get("/tag-users", verifyToken, getUsersForTagging);
router.get("/users", verifyToken, fetchUsers);
router.post("/assign-user", verifyToken, assignUser);
router.post("/unassign-user", verifyToken, unassignUser);
router.get("/current-user", verifyToken, getCurrentUser);
router.get("/notifications", verifyToken, fetchNotifications);
router.post("/notificationsread", verifyToken, markNotificationsRead);
router.delete("/notificationsdelete", verifyToken, clearNotifications);
router.get("/export-attendance", verifyToken, exportAttendance);
module.exports = router;

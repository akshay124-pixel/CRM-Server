const express = require("express");
const DataLogic = require("../Controller/DataLogic");
const { verifyToken } = require("../utils/config jwt");
const router = express.Router();

router.post("/entry", verifyToken, DataLogic.DataentryLogic);
router.get("/fetch-entry", verifyToken, DataLogic.fetchEntries);
router.delete("/entry/:id", verifyToken, DataLogic.DeleteData);
router.put("/editentry/:id", DataLogic.editEntry);
router.get("/export", verifyToken, DataLogic.exportentry);
router.post("/entries", verifyToken, DataLogic.bulkUploadStocks);
router.get("/user-role", verifyToken, DataLogic.getAdmin);
router.get("/users", verifyToken, DataLogic.fetchUsers);
router.post("/assign-user", verifyToken, DataLogic.assignUser);
router.post("/unassign-user", verifyToken, DataLogic.unassignUser);
router.post("/check-in", DataLogic.checkIn);
router.post("/check-out", DataLogic.checkOut);
router.get("/attendance", DataLogic.fetchAttendance);

module.exports = router;

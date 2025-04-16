const { Login } = require("../Controller/AuthLogic");

const express = require("express");
const router = express.Router();

router.route("/login").post(Login);

module.exports = router;

const { v4: uuidv4 } = require("uuid");

function uuid() {
  return uuidv4().replace(/-/g, "");
}

module.exports = uuid;

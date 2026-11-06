const fs = require("fs");
if (fs.realpathSync && fs.realpathSync.native) {
  fs.realpathSync.native = fs.realpathSync;
}

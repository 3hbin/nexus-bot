// Thư mục lưu data bền — Railway: gắn Volume + set DATA_DIR=/data
const path = require('path');
const fs = require('fs');

const DATA_DIR = (process.env.DATA_DIR || path.join(__dirname, 'data')).trim();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) {}

function dataFile(name) {
  return path.join(DATA_DIR, name);
}

module.exports = {
  DATA_DIR,
  dataFile,
};

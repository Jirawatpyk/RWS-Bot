const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../Task/acceptedTasks.json');
const raw = fs.readFileSync(filePath, 'utf-8');
const tasks = JSON.parse(raw);

console.log('Before:', tasks.length, 'tasks');

// เก็บเฉพาะ task แรกของแต่ละ orderId
const seen = new Set();
const unique = [];

for (const task of tasks) {
  if (!seen.has(task.orderId)) {
    seen.add(task.orderId);
    unique.push(task);
  }
}

console.log('After:', unique.length, 'tasks');
console.log('Removed:', tasks.length - unique.length, 'duplicates');

// เขียนกลับ
fs.writeFileSync(filePath, JSON.stringify(unique, null, 2));
console.log('✅ Done!');

// แสดงยอดรวม words
const totalWords = unique.reduce((sum, t) => sum + (t.amountWords || 0), 0);
console.log('Total words:', totalWords);

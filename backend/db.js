const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examflow';
let isMongoConnected = false;

// Attempt to connect to MongoDB
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 3000 // Timeout fast so we can fallback to local JSON database quickly if needed
})
.then(() => {
  console.log('Successfully connected to MongoDB.');
  isMongoConnected = true;
})
.catch(err => {
  console.warn('MongoDB connection failed. Falling back to Local JSON database.');
  console.warn('Error detail:', err.message);
  isMongoConnected = false;
});

// JSON fallback DB path setup
const JSON_DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(JSON_DB_DIR)) {
  fs.mkdirSync(JSON_DB_DIR, { recursive: true });
}

// JSON file helper functions
const getJsonPath = (collectionName) => path.join(JSON_DB_DIR, `${collectionName}.json`);

const readJson = (collectionName) => {
  const filePath = getJsonPath(collectionName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error(`Error reading JSON file ${collectionName}:`, error);
    return [];
  }
};

const writeJson = (collectionName, data) => {
  const filePath = getJsonPath(collectionName);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing JSON file ${collectionName}:`, error);
    return false;
  }
};

// Generate UUID-like strings for JSON DB entries
const generateId = () => {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};

// MONGOOSE SCHEMAS (Used when connected to MongoDB)
const StudentSchema = new mongoose.Schema({
  registerNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  batch: { type: String, default: '2024-25' }
});

const HallSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rows: { type: Number, required: true },
  columns: { type: Number, required: true },
  capacity: { type: Number, required: true },
  benches: { type: Number, required: true }
});

const ExamSchema = new mongoose.Schema({
  name: { type: String, required: true },
  departments: [{ type: String }],
  date: { type: String, required: true },
  session: { type: String, enum: ['FN', 'AN'], required: true },
  studentsCount: { type: Number, default: 0 },
  status: { type: String, enum: ['Draft', 'Scheduled', 'Active'], default: 'Draft' },
  assignedHalls: [{ type: String }] // Hall IDs or names
});

const SeatingPlanSchema = new mongoose.Schema({
  examId: { type: String, required: true },
  examName: { type: String, required: true },
  hallId: { type: String, required: true },
  hallName: { type: String, required: true },
  seatingGrid: { type: Array, required: true }, // array of bench arrangements
  attendanceRoster: { type: Array, required: true }, // array of registered student placements
  totalBenches: { type: Number },
  totalStudents: { type: Number },
  emptySeats: { type: Number },
  generatedAt: { type: Date, default: Date.now }
});

const UploadHistorySchema = new mongoose.Schema({
  filename: { type: String, required: true },
  recordCount: { type: Number, default: 0 },
  status: { type: String, required: true }, // SUCCESS, FAILED
  errorMessage: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now }
});

const MongoStudent = mongoose.model('Student', StudentSchema);
const MongoHall = mongoose.model('Hall', HallSchema);
const MongoExam = mongoose.model('Exam', ExamSchema);
const MongoSeatingPlan = mongoose.model('SeatingPlan', SeatingPlanSchema);
const MongoUploadHistory = mongoose.model('UploadHistory', UploadHistorySchema);

// UNIFIED MODEL INTERFACE (Transparently swaps between Mongo and JSON Files)
const Models = {
  Student: {
    find: async (query = {}) => {
      if (isMongoConnected) return MongoStudent.find(query);
      let data = readJson('students');
      if (query.registerNo) data = data.filter(s => s.registerNo === query.registerNo);
      if (query.department) data = data.filter(s => s.department === query.department);
      return data;
    },
    findOne: async (query = {}) => {
      if (isMongoConnected) return MongoStudent.findOne(query);
      const data = readJson('students');
      return data.find(s => {
        for (let key in query) {
          if (s[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      if (isMongoConnected) return MongoStudent.create(doc);
      const docs = Array.isArray(doc) ? doc : [doc];
      const data = readJson('students');
      const added = [];
      for (let item of docs) {
        // Enforce uniqueness of registerNo
        const exists = data.some(s => s.registerNo === item.registerNo);
        if (!exists) {
          const newItem = { _id: generateId(), ...item };
          data.push(newItem);
          added.push(newItem);
        }
      }
      writeJson('students', data);
      return Array.isArray(doc) ? added : added[0];
    },
    deleteMany: async (query = {}) => {
      if (isMongoConnected) return MongoStudent.deleteMany(query);
      if (Object.keys(query).length === 0) {
        writeJson('students', []);
        return { deletedCount: 0 }; // count doesn't matter for mock
      }
      let data = readJson('students');
      const prevLen = data.length;
      data = data.filter(s => {
        for (let key in query) {
          if (s[key] === query[key]) return false;
        }
        return true;
      });
      writeJson('students', data);
      return { deletedCount: prevLen - data.length };
    },
    countDocuments: async (query = {}) => {
      if (isMongoConnected) return MongoStudent.countDocuments(query);
      const data = readJson('students');
      if (Object.keys(query).length === 0) return data.length;
      return data.filter(s => {
        for (let key in query) {
          if (s[key] !== query[key]) return false;
        }
        return true;
      }).length;
    }
  },

  Hall: {
    find: async (query = {}) => {
      if (isMongoConnected) return MongoHall.find(query);
      return readJson('halls');
    },
    findById: async (id) => {
      if (isMongoConnected) return MongoHall.findById(id);
      const data = readJson('halls');
      return data.find(h => h._id === id) || null;
    },
    create: async (doc) => {
      if (isMongoConnected) return MongoHall.create(doc);
      const data = readJson('halls');
      const newItem = { _id: generateId(), ...doc };
      data.push(newItem);
      writeJson('halls', data);
      return newItem;
    },
    findByIdAndDelete: async (id) => {
      if (isMongoConnected) return MongoHall.findByIdAndDelete(id);
      let data = readJson('halls');
      const item = data.find(h => h._id === id);
      data = data.filter(h => h._id !== id);
      writeJson('halls', data);
      return item || null;
    },
    countDocuments: async () => {
      if (isMongoConnected) return MongoHall.countDocuments();
      return readJson('halls').length;
    }
  },

  Exam: {
    find: async (query = {}) => {
      if (isMongoConnected) return MongoExam.find(query);
      let data = readJson('exams');
      if (query.status) data = data.filter(e => e.status === query.status);
      return data;
    },
    findById: async (id) => {
      if (isMongoConnected) return MongoExam.findById(id);
      const data = readJson('exams');
      return data.find(e => e._id === id) || null;
    },
    create: async (doc) => {
      if (isMongoConnected) return MongoExam.create(doc);
      const data = readJson('exams');
      const newItem = { _id: generateId(), ...doc };
      data.push(newItem);
      writeJson('exams', data);
      return newItem;
    },
    findByIdAndDelete: async (id) => {
      if (isMongoConnected) return MongoExam.findByIdAndDelete(id);
      let data = readJson('exams');
      const item = data.find(e => e._id === id);
      data = data.filter(e => e._id !== id);
      writeJson('exams', data);
      return item || null;
    },
    countDocuments: async (query = {}) => {
      if (isMongoConnected) return MongoExam.countDocuments(query);
      let data = readJson('exams');
      if (query.status) data = data.filter(e => e.status === query.status);
      return data.length;
    }
  },

  SeatingPlan: {
    find: async (query = {}) => {
      if (isMongoConnected) return MongoSeatingPlan.find(query);
      let data = readJson('seating_plans');
      if (query.examId) data = data.filter(p => p.examId === query.examId);
      if (query.hallId) data = data.filter(p => p.hallId === query.hallId);
      return data;
    },
    findOne: async (query = {}) => {
      if (isMongoConnected) return MongoSeatingPlan.findOne(query);
      const data = readJson('seating_plans');
      return data.find(p => {
        for (let key in query) {
          if (p[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      if (isMongoConnected) return MongoSeatingPlan.create(doc);
      const data = readJson('seating_plans');
      // Delete old seating plan for same exam/hall if it exists
      const filteredData = data.filter(p => !(p.examId === doc.examId && p.hallId === doc.hallId));
      const newItem = { _id: generateId(), ...doc, generatedAt: new Date() };
      filteredData.push(newItem);
      writeJson('seating_plans', filteredData);
      return newItem;
    },
    deleteMany: async (query = {}) => {
      if (isMongoConnected) return MongoSeatingPlan.deleteMany(query);
      if (Object.keys(query).length === 0) {
        writeJson('seating_plans', []);
        return { deletedCount: 0 };
      }
      let data = readJson('seating_plans');
      const prevLen = data.length;
      data = data.filter(p => {
        for (let key in query) {
          if (p[key] === query[key]) return false;
        }
        return true;
      });
      writeJson('seating_plans', data);
      return { deletedCount: prevLen - data.length };
    }
  },

  UploadHistory: {
    find: async (query = {}) => {
      if (isMongoConnected) return MongoUploadHistory.find(query).sort({ uploadedAt: -1 });
      const data = readJson('upload_history');
      return data.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    },
    create: async (doc) => {
      if (isMongoConnected) return MongoUploadHistory.create(doc);
      const data = readJson('upload_history');
      const newItem = { _id: generateId(), ...doc, uploadedAt: new Date() };
      data.push(newItem);
      writeJson('upload_history', data);
      return newItem;
    },
    deleteMany: async (query = {}) => {
      if (isMongoConnected) return MongoUploadHistory.deleteMany(query);
      if (Object.keys(query).length === 0) {
        writeJson('upload_history', []);
        return { deletedCount: 0 };
      }
      return { deletedCount: 0 };
    }
  }
};

module.exports = {
  dbStatus: () => ({
    connected: isMongoConnected,
    mode: isMongoConnected ? 'MongoDB' : 'Local JSON'
  }),
  Models
};

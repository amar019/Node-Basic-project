import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from root directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });


console.log("MONGO_URI:", process.env.MONGO_URI);

import connectDB from "./db/index.js";
import { app } from "./app.js";


connectDB()
  .then(() => {
    app.listen(process.env.PORT || 8080, () => {
      console.log("server is running ✅");
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed !!!❌");
  });

import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";

dotenv.config();

connectDB()
  .then(() => {
    app.listen(process.env.PORT || 8080, () => {
      console.log("server is running ✅");
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed !!!❌");
  });

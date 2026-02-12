import mongoose from "mongoose";
import { DB_Names } from "../constant.js";

const connectDB = async () => {
  try {
    await mongoose.connect(`${process.env.MONGO_URI}/${DB_Names}`);
    console.log("\n MongoDB connected !! ");
  } catch (err) {
    console.log("MongoDB connection error", err);
    process.exit(1);
  }
};
export default connectDB;
